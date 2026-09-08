"""Motor de calculos: metricas sobre o resultado da Receita."""

from __future__ import annotations

import logging
from typing import Any

import duckdb

from app.engine.compiler import CompilationError
from app.engine.executor import ExecutionError, connect, count_input_rows, to_json_value
from app.engine.schema import DatasetSchema, SchemaError, quote_ident

logger = logging.getLogger(__name__)

# Operacoes que medem LINHAS e nao uma coluna: "quantos registros sobraram" e
# "que fracao do total isso representa".
COLUMNLESS = frozenset({"count", "percentage"})

# Operacoes que exigem coluna numerica. Pedir a media de uma coluna de texto e
# erro do usuario, e a mensagem precisa dizer isso -- nao devolver zero.
NUMERIC_ONLY = frozenset({"sum", "avg", "min", "max", "median"})

OPERATION_LABELS = {
    "count": "contagem",
    "count_distinct": "contagem de valores unicos",
    "count_empty": "contagem de vazios",
    "sum": "soma",
    "avg": "media",
    "min": "minimo",
    "max": "maximo",
    "median": "mediana",
    "percentage": "percentual",
}


def _expression(metric: dict, schema: DatasetSchema, input_rows: int) -> str:
    """Expressao SQL de uma metrica."""
    operation = metric["operation"]

    if operation == "count":
        return "COUNT(*)"

    if operation == "percentage":
        # Percentual do total ORIGINAL da planilha, nao do resultado -- que
        # seria sempre 100%. Responde "que fatia da base sobrou apos os
        # filtros?", que e a pergunta real.
        if input_rows <= 0:
            return "NULL"
        return f"COUNT(*) * 100.0 / {input_rows}"

    column_name = metric.get("column")
    if not column_name:
        raise CompilationError(
            f'A operacao "{OPERATION_LABELS.get(operation, operation)}" exige uma coluna.'
        )

    column = schema.resolve(column_name)
    ident = quote_ident(column.name)

    if operation == "count_distinct":
        return f"COUNT(DISTINCT {ident})"

    if operation == "count_empty":
        if column.type in ("text", "empty"):
            return (
                f"SUM(CASE WHEN {ident} IS NULL "
                f"OR TRIM(CAST({ident} AS VARCHAR)) = '' THEN 1 ELSE 0 END)"
            )
        return f"SUM(CASE WHEN {ident} IS NULL THEN 1 ELSE 0 END)"

    if operation in NUMERIC_ONLY:
        if not column.is_numeric:
            raise CompilationError(
                f'Nao e possivel calcular a {OPERATION_LABELS[operation]} de "{column.name}": '
                "a coluna nao contem valores numericos."
            )
        function = {"avg": "AVG", "sum": "SUM", "min": "MIN", "max": "MAX", "median": "MEDIAN"}[
            operation
        ]
        return f"{function}({ident})"

    raise CompilationError(f'Operacao desconhecida: "{operation}".')


def compute_metrics(
    parquet_path,
    schema: DatasetSchema,
    recipe: dict,
    metrics: list[dict],
) -> list[dict[str, Any]]:
    """Calcula todas as metricas do resultado da receita.

    TODAS numa unica consulta agregada: uma consulta por metrica significaria
    reexecutar a cadeia de filtros N vezes. Com cinco analises sobre 500 mil
    linhas, a diferenca e entre uma varredura e cinco.

    Metricas invalidas nao derrubam as demais -- cada uma carrega o proprio
    erro, e o painel mostra os resultados que deram certo.
    """
    from app.engine.executor import _prepare  # import tardio: evita ciclo

    if not metrics:
        return []

    compiled = _prepare(parquet_path, schema, recipe)

    with connect() as connection:
        input_rows = count_input_rows(connection, parquet_path)

        selects: list[str] = []
        results: list[dict[str, Any]] = []
        computed_index: dict[str, int] = {}

        for metric in metrics:
            entry: dict[str, Any] = {
                "id": metric["id"],
                "label": metric.get("label") or _default_label(metric),
                "operation": metric["operation"],
                "column": metric.get("column"),
                "value": None,
                "format": metric.get("format"),
                "error": None,
            }
            try:
                expression = _expression(metric, compiled.schema, input_rows)
            except (CompilationError, SchemaError) as error:
                # A metrica falha sozinha. Uma coluna renomeada na planilha nao
                # pode apagar as outras quatro analises da tela.
                entry["error"] = str(error)
                results.append(entry)
                continue

            alias = f"m{len(selects)}"
            computed_index[metric["id"]] = len(selects)
            selects.append(f"{expression} AS {quote_ident(alias)}")
            results.append(entry)

        if not selects:
            return results

        sql = (
            f"WITH result AS ({compiled.sql}) "
            f"SELECT {', '.join(selects)} FROM result"
        )

        try:
            record = connection.execute(sql, compiled.params).fetchone()
        except duckdb.Error as error:
            logger.exception("Falha ao calcular metricas")
            raise ExecutionError(
                "Nao foi possivel calcular as analises sobre esta planilha."
            ) from error

    for entry in results:
        position = computed_index.get(entry["id"])
        if position is not None and record is not None:
            raw = to_json_value(record[position])
            entry["value"] = float(raw) if isinstance(raw, (int, float, str)) and raw != "" else None
            if isinstance(raw, str):
                try:
                    entry["value"] = float(raw)
                except ValueError:
                    entry["value"] = None

    return results


def _default_label(metric: dict) -> str:
    operation = metric["operation"]
    if operation == "count":
        return "Contagem de registros"
    if operation == "percentage":
        return "Percentual do total"
    label = OPERATION_LABELS.get(operation, operation).capitalize()
    return f"{label} de {metric.get('column')}"


def suggest_metrics(schema: DatasetSchema) -> list[dict[str, Any]]:
    """Analises iniciais sugeridas a partir das colunas do dataset.

    Um painel de analises em branco nao ensina nada a quem nunca usou. Comecar
    com contagem e, havendo coluna monetaria, soma e media, mostra o formato do
    resultado e serve de ponto de partida para editar.
    """
    suggestions: list[dict[str, Any]] = [
        {"id": "count", "operation": "count", "label": "Registros no resultado", "format": "integer"}
    ]

    money = next(
        (name for name in schema.names if schema.resolve(name).type == "currency"),
        None,
    )
    if money:
        suggestions.append(
            {"id": "sum", "operation": "sum", "column": money,
             "label": f"Soma de {money}", "format": "currency"}
        )
        suggestions.append(
            {"id": "avg", "operation": "avg", "column": money,
             "label": f"Media de {money}", "format": "currency"}
        )

    return suggestions
