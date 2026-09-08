"""Compilador de Receitas: JSON validado -> SQL DuckDB parametrizado.

DUAS REGRAS INVIOLAVEIS neste arquivo:

  1. Todo identificador de coluna vem de `DatasetSchema.resolve()`, que so
     devolve colunas existentes no dataset. Nome inventado e recusado antes de
     qualquer geracao de SQL.
  2. Todo valor do usuario vira PARAMETRO VINCULADO (`?`). Nenhum valor e
     concatenado na string SQL, em nenhuma circunstancia.

A consequencia e estrutural: nao existe caminho pelo qual texto de usuario --
ou saida de IA -- se torne SQL executavel. A IA da Fase 10 produz a mesma
Receita JSON e passa por este mesmo compilador; ela nao tem privilegio algum.

Cada passo da receita vira uma CTE encadeada. O DuckDB otimiza a cadeia inteira
como uma consulta so, com predicate e projection pushdown ate o Parquet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.engine.schema import DatasetSchema, SchemaError, quote_ident

# Coluna sintetica com a ordem original das linhas.
#
# O Parquet nao tem chave primaria nem ordem garantida entre operacoes. Sem uma
# ancora, "manter a primeira ocorrencia" ao remover duplicados seria arbitrario
# e mudaria entre execucoes da MESMA receita sobre o MESMO arquivo -- o usuario
# veria contagens diferentes sem ter mudado nada.
ROW_ORDER = "__ef_row"


class CompilationError(ValueError):
    """Receita invalida para este dataset. Mensagem segura para o usuario."""


@dataclass
class Params:
    """Coleta os valores vinculados na ordem em que aparecem no SQL."""

    values: list[Any] = field(default_factory=list)

    def bind(self, value: Any) -> str:
        self.values.append(value)
        return "?"


@dataclass
class CompiledQuery:
    sql: str
    params: list[Any]
    schema: DatasetSchema

    @property
    def columns(self) -> list[str]:
        return self.schema.names


# ---------------------------------------------------------------------------
# Filtros
# ---------------------------------------------------------------------------

def _coerce(value: Any, column) -> Any:
    """Converte o valor do filtro para o tipo da coluna.

    O JSON nao distingue "500" de 500, e o usuario digita numero num campo de
    texto o tempo todo. Sem esta conversao, `valor > "500"` compararia texto com
    numero e devolveria resultado errado sem emitir erro nenhum -- o pior tipo
    de falha num relatorio.
    """
    if value is None:
        return None

    if column.is_numeric:
        if isinstance(value, bool):
            raise CompilationError(f'Valor invalido para a coluna numerica "{column.name}".')
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip().replace("R$", "").replace(" ", "")
        # Aceita tanto "1.234,56" quanto "1234.56": o usuario digita como esta
        # acostumado, nao como o banco espera.
        if "," in text:
            text = text.replace(".", "").replace(",", ".")
        try:
            return float(text)
        except ValueError as error:
            raise CompilationError(
                f'"{value}" nao e um numero valido para a coluna "{column.name}".'
            ) from error

    if column.is_date:
        return str(value)

    if column.type == "boolean":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"true", "sim", "1", "s", "yes"}

    return str(value)


def _column_expr(column, alias: str | None = None) -> str:
    prefix = f"{quote_ident(alias)}." if alias else ""
    return f"{prefix}{quote_ident(column.name)}"


def _date_expr(placeholder: str) -> str:
    """Converte o parametro textual em timestamp.

    `TRY_CAST` e proposital: uma data mal digitada vira NULL e o filtro
    simplesmente nao casa, em vez de abortar a consulta inteira com erro de
    conversao.
    """
    return f"TRY_CAST({placeholder} AS TIMESTAMP)"


def _compile_condition(node: dict, schema: DatasetSchema, params: Params) -> str:
    column = schema.resolve(node["column"])
    operator = node["operator"]
    target = _column_expr(column)
    case_sensitive = bool(node.get("caseSensitive", False))

    # --- operadores sem valor ---
    if operator == "is_empty":
        # Texto vazio e NULL sao a mesma coisa para o usuario. A ingestao ja
        # normaliza, mas uma receita pode rodar depois de um `fill_empty`.
        if column.type in ("text", "empty"):
            return f"({target} IS NULL OR TRIM(CAST({target} AS VARCHAR)) = '')"
        return f"{target} IS NULL"
    if operator == "is_not_empty":
        if column.type in ("text", "empty"):
            return f"({target} IS NOT NULL AND TRIM(CAST({target} AS VARCHAR)) <> '')"
        return f"{target} IS NOT NULL"
    if operator == "is_true":
        return f"{target} = TRUE"
    if operator == "is_false":
        return f"{target} = FALSE"

    # --- operadores de texto ---
    if operator in ("contains", "not_contains", "starts_with", "ends_with"):
        raw = str(node.get("value") or "")
        # Escapa os curingas do LIKE. Sem isso, buscar por "50%" traria tudo que
        # comeca com 50 -- o usuario nao sabe que "%" e curinga.
        escaped = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = {
            "contains": f"%{escaped}%",
            "not_contains": f"%{escaped}%",
            "starts_with": f"{escaped}%",
            "ends_with": f"%{escaped}",
        }[operator]

        left = f"CAST({target} AS VARCHAR)"
        placeholder = params.bind(pattern)
        if not case_sensitive:
            left = f"LOWER({left})"
            placeholder = f"LOWER({placeholder})"

        expression = f"{left} LIKE {placeholder} ESCAPE '\\'"
        if operator == "not_contains":
            # NULL nao casa com LIKE, e "nao contem" precisa incluir os vazios:
            # uma celula em branco de fato nao contem o texto procurado.
            return f"({target} IS NULL OR NOT ({expression}))"
        return expression

    # --- igualdade ---
    if operator in ("equals", "not_equals"):
        value = _coerce(node.get("value"), column)
        if value is None:
            return f"{target} IS NULL" if operator == "equals" else f"{target} IS NOT NULL"

        if column.type in ("text", "empty") and not case_sensitive:
            left = f"LOWER(TRIM(CAST({target} AS VARCHAR)))"
            right = f"LOWER(TRIM({params.bind(value)}))"
        else:
            left, right = target, params.bind(value)

        if operator == "equals":
            return f"{left} = {right}"
        # "diferente de" tem que trazer os NULL: uma celula vazia e, sim,
        # diferente de "APROVADO". Sem o OR, a linha sumiria do resultado.
        return f"({left} <> {right} OR {target} IS NULL)"

    # --- listas ---
    if operator in ("in", "not_in"):
        values = node.get("values") or []
        if not values:
            raise CompilationError(f'A condicao sobre "{column.name}" nao tem valores.')
        coerced = [_coerce(v, column) for v in values]

        if column.type in ("text", "empty") and not case_sensitive:
            left = f"LOWER(TRIM(CAST({target} AS VARCHAR)))"
            items = ", ".join(f"LOWER(TRIM({params.bind(v)}))" for v in coerced)
        else:
            left = target
            items = ", ".join(params.bind(v) for v in coerced)

        if operator == "in":
            return f"{left} IN ({items})"
        return f"({left} NOT IN ({items}) OR {target} IS NULL)"

    # --- comparacoes numericas ---
    if operator in ("greater_than", "greater_or_equal", "less_than", "less_or_equal"):
        symbol = {
            "greater_than": ">",
            "greater_or_equal": ">=",
            "less_than": "<",
            "less_or_equal": "<=",
        }[operator]
        value = _coerce(node.get("value"), column)
        return f"{target} {symbol} {params.bind(value)}"

    if operator == "between":
        low, high = node.get("range", [None, None])
        low_value = _coerce(low, column)
        high_value = _coerce(high, column)
        # Intervalo invertido e engano comum de digitacao. Normalizar e melhor
        # do que devolver zero resultado sem explicacao.
        if isinstance(low_value, float) and isinstance(high_value, float) and low_value > high_value:
            low_value, high_value = high_value, low_value
        return f"{target} BETWEEN {params.bind(low_value)} AND {params.bind(high_value)}"

    # --- datas ---
    if operator in ("date_equals", "date_before", "date_after"):
        placeholder = params.bind(str(node.get("value")))
        moment = _date_expr(placeholder)
        if operator == "date_equals":
            # Compara o DIA, nao o instante: uma coluna com hora nunca casaria
            # com "08/09/2026" se comparassemos o timestamp completo.
            return f"CAST({target} AS DATE) = CAST({moment} AS DATE)"
        if operator == "date_before":
            return f"{target} < {moment}"
        return f"{target} >= {moment} + INTERVAL 1 DAY"

    if operator == "date_between":
        start, end = node.get("range", [None, None])
        start_expr = _date_expr(params.bind(str(start)))
        end_expr = _date_expr(params.bind(str(end)))
        # Fim INCLUSIVO: quem escolhe "01/09 a 30/09" espera o dia 30 inteiro,
        # nao os registros ate a meia-noite do dia 30.
        return (
            f"({target} >= CAST({start_expr} AS DATE) "
            f"AND {target} < CAST({end_expr} AS DATE) + INTERVAL 1 DAY)"
        )

    raise CompilationError(f'Operador desconhecido: "{operator}".')


def compile_filter(node: dict, schema: DatasetSchema, params: Params) -> str:
    """Compila a arvore de filtros recursivamente."""
    if node.get("type") == "condition":
        return _compile_condition(node, schema, params)

    children = node.get("children") or []
    if not children:
        # Grupo vazio nao filtra nada. O construtor da interface comeca assim, e
        # tratar como "nenhum resultado" deixaria a tela vazia sem motivo.
        return "TRUE"

    logic = " AND " if node.get("logic", "AND") == "AND" else " OR "
    parts = [compile_filter(child, schema, params) for child in children]
    combined = "(" + logic.join(parts) + ")"
    return f"NOT {combined}" if node.get("negate") else combined


# ---------------------------------------------------------------------------
# Passos
# ---------------------------------------------------------------------------

def _step_filter(step: dict, schema: DatasetSchema, source: str, params: Params) -> tuple[str, DatasetSchema]:
    predicate = compile_filter(step["filter"], schema, params)
    return f"SELECT * FROM {source} WHERE {predicate}", schema


def _step_drop_duplicates(step: dict, schema: DatasetSchema, source: str, params: Params):
    columns = step.get("columns") or schema.names
    resolved = [schema.resolve(name) for name in columns]
    partition = ", ".join(_column_expr(c) for c in resolved)
    keep = step.get("keep", "first")

    if keep == "none":
        # Descarta TODAS as ocorrencias, nao so as repetidas. Serve a auditoria:
        # o objetivo e isolar registros problematicos, nao ficar com um deles.
        return (
            f"SELECT * FROM {source} "
            f"QUALIFY COUNT(*) OVER (PARTITION BY {partition}) = 1",
            schema,
        )

    direction = "ASC" if keep == "first" else "DESC"
    return (
        f"SELECT * FROM {source} "
        f"QUALIFY ROW_NUMBER() OVER ("
        f"PARTITION BY {partition} ORDER BY {quote_ident(ROW_ORDER)} {direction}) = 1",
        schema,
    )


def _step_drop_empty_rows(step: dict, schema: DatasetSchema, source: str, params: Params):
    columns = step.get("columns") or schema.names
    resolved = [schema.resolve(name) for name in columns]

    def blank(column) -> str:
        target = _column_expr(column)
        if column.type in ("text", "empty"):
            return f"({target} IS NULL OR TRIM(CAST({target} AS VARCHAR)) = '')"
        return f"{target} IS NULL"

    checks = [blank(c) for c in resolved]
    # 'all' remove so a linha TOTALMENTE vazia; 'any' remove se qualquer uma das
    # colunas escolhidas estiver vazia.
    condition = " AND ".join(checks) if step.get("mode", "all") == "all" else " OR ".join(checks)
    return f"SELECT * FROM {source} WHERE NOT ({condition})", schema


def _step_select_columns(step: dict, schema: DatasetSchema, source: str, params: Params):
    names = step["columns"]
    new_schema = schema.subset(names)
    projection = ", ".join(quote_ident(c.name) for c in (schema.resolve(n) for n in names))
    # ROW_ORDER acompanha a projecao: passos posteriores (dedupe, ordenacao)
    # ainda precisam dele, e ele e removido so na materializacao final.
    return f"SELECT {projection}, {quote_ident(ROW_ORDER)} FROM {source}", new_schema


def _step_drop_columns(step: dict, schema: DatasetSchema, source: str, params: Params):
    removed = {schema.resolve(name).name for name in step["columns"]}
    remaining = [name for name in schema.names if name not in removed]
    if not remaining:
        raise CompilationError("O tratamento removeria todas as colunas da planilha.")
    return _step_select_columns({"columns": remaining}, schema, source, params)


def _step_rename_columns(step: dict, schema: DatasetSchema, source: str, params: Params):
    mapping: dict[str, str] = {}
    for entry in step["mapping"]:
        origin = schema.resolve(entry["from"]).name
        destination = str(entry["to"]).strip()
        if not destination:
            raise CompilationError(f'O novo nome para a coluna "{origin}" esta vazio.')
        mapping[origin] = destination

    final_names = [mapping.get(name, name) for name in schema.names]
    duplicates = {n for n in final_names if final_names.count(n) > 1}
    if duplicates:
        # Nomes repetidos quebrariam a referencia por nome em todos os passos
        # seguintes -- e o erro so apareceria la na frente, sem relacao obvia.
        raise CompilationError(
            f"A renomeacao criaria colunas com o mesmo nome: {', '.join(sorted(duplicates))}."
        )

    projection = ", ".join(
        f"{quote_ident(name)} AS {quote_ident(mapping[name])}" if name in mapping
        else quote_ident(name)
        for name in schema.names
    )
    return (
        f"SELECT {projection}, {quote_ident(ROW_ORDER)} FROM {source}",
        schema.renamed(mapping),
    )


def _step_sort(step: dict, schema: DatasetSchema, source: str, params: Params):
    parts = []
    for entry in step["by"]:
        column = schema.resolve(entry["column"])
        direction = "DESC" if entry.get("direction") == "desc" else "ASC"
        # NULLS LAST em ambas as direcoes: vazios no topo de um relatorio
        # ordenado por valor nunca sao o que o usuario quer ver primeiro.
        parts.append(f"{_column_expr(column)} {direction} NULLS LAST")
    return f"SELECT * FROM {source} ORDER BY {', '.join(parts)}", schema


def _step_cast(step: dict, schema: DatasetSchema, source: str, params: Params):
    column = schema.resolve(step["column"])
    target_type = step["to"]
    source_expr = _column_expr(column)

    if target_type == "number":
        # TRY_CAST em vez de CAST: uma celula que nao converte vira nulo, e o
        # usuario ve isso no contador de vazios. CAST abortaria a receita
        # inteira por causa de uma linha.
        expression = (
            f"TRY_CAST(REPLACE(REPLACE(REPLACE("
            f"CAST({source_expr} AS VARCHAR), 'R$', ''), '.', ''), ',', '.') AS DOUBLE)"
        )
        new_type = "number"
    elif target_type == "date":
        fmt = step.get("format")
        if fmt:
            expression = f"TRY_STRPTIME(CAST({source_expr} AS VARCHAR), {params.bind(fmt)})"
        else:
            expression = f"TRY_CAST({source_expr} AS TIMESTAMP)"
        new_type = "date"
    elif target_type == "boolean":
        expression = (
            f"CASE WHEN LOWER(TRIM(CAST({source_expr} AS VARCHAR))) "
            f"IN ('true','sim','s','1','yes') THEN TRUE "
            f"WHEN LOWER(TRIM(CAST({source_expr} AS VARCHAR))) "
            f"IN ('false','nao','não','n','0','no') THEN FALSE END"
        )
        new_type = "boolean"
    else:
        expression = f"CAST({source_expr} AS VARCHAR)"
        new_type = "text"

    projection = ", ".join(
        f"{expression} AS {quote_ident(name)}" if name == column.name else quote_ident(name)
        for name in schema.names
    )
    return (
        f"SELECT {projection}, {quote_ident(ROW_ORDER)} FROM {source}",
        schema.with_type(column.name, new_type),  # type: ignore[arg-type]
    )


def _step_replace_values(step: dict, schema: DatasetSchema, source: str, params: Params):
    column = schema.resolve(step["column"])
    target = f"CAST({_column_expr(column)} AS VARCHAR)"
    mode = step.get("mode", "exact")

    expression = target
    for entry in step["replacements"]:
        origin = params.bind(str(entry["from"]))
        destination = params.bind(str(entry["to"]))
        if mode == "exact":
            expression = f"CASE WHEN TRIM({expression}) = TRIM({origin}) THEN {destination} ELSE {expression} END"
        else:
            expression = f"REPLACE({expression}, {origin}, {destination})"

    projection = ", ".join(
        f"{expression} AS {quote_ident(name)}" if name == column.name else quote_ident(name)
        for name in schema.names
    )
    # A substituicao produz texto, e o tipo da coluna precisa refletir isso: uma
    # coluna monetaria com "N/A" no lugar dos vazios nao e mais somavel.
    return (
        f"SELECT {projection}, {quote_ident(ROW_ORDER)} FROM {source}",
        schema.with_type(column.name, "text"),
    )


def _step_fill_empty(step: dict, schema: DatasetSchema, source: str, params: Params):
    column = schema.resolve(step["column"])
    target = _column_expr(column)
    value = _coerce(step["value"], column)
    placeholder = params.bind(value)

    if column.type in ("text", "empty"):
        condition = f"({target} IS NULL OR TRIM(CAST({target} AS VARCHAR)) = '')"
        expression = f"CASE WHEN {condition} THEN {placeholder} ELSE {target} END"
    else:
        expression = f"COALESCE({target}, {placeholder})"

    projection = ", ".join(
        f"{expression} AS {quote_ident(name)}" if name == column.name else quote_ident(name)
        for name in schema.names
    )
    return f"SELECT {projection}, {quote_ident(ROW_ORDER)} FROM {source}", schema


STEP_COMPILERS = {
    "filter": _step_filter,
    "drop_duplicates": _step_drop_duplicates,
    "drop_empty_rows": _step_drop_empty_rows,
    "select_columns": _step_select_columns,
    "drop_columns": _step_drop_columns,
    "rename_columns": _step_rename_columns,
    "sort": _step_sort,
    "cast": _step_cast,
    "replace_values": _step_replace_values,
    "fill_empty": _step_fill_empty,
}


# ---------------------------------------------------------------------------
# Receita completa
# ---------------------------------------------------------------------------

def compile_recipe(
    recipe: dict,
    schema: DatasetSchema,
    parquet_path: str,
) -> CompiledQuery:
    """Compila a receita numa cadeia de CTEs sobre o Parquet."""
    params = Params()

    # ROW_ORDER e criado na base e propagado por todos os passos, dando ancora
    # estavel para "manter a primeira ocorrencia".
    ctes = [
        f"s0 AS (SELECT *, ROW_NUMBER() OVER () AS {quote_ident(ROW_ORDER)} "
        f"FROM read_parquet({params.bind(parquet_path)}))"
    ]

    current = "s0"
    current_schema = schema

    for index, step in enumerate(recipe.get("steps") or [], start=1):
        kind = step.get("kind")
        compiler = STEP_COMPILERS.get(kind)
        if compiler is None:
            raise CompilationError(f'Operacao desconhecida: "{kind}".')

        try:
            body, current_schema = compiler(step, current_schema, current, params)
        except SchemaError as error:
            raise CompilationError(str(error)) from error

        name = f"s{index}"
        ctes.append(f"{name} AS ({body})")
        current = name

    sql = "WITH " + ",\n     ".join(ctes) + f"\nSELECT * FROM {current}"
    return CompiledQuery(sql=sql, params=params.values, schema=current_schema)


def projection_without_row_order(schema: DatasetSchema) -> str:
    """Projecao final, sem a coluna sintetica de ordem.

    ROW_ORDER e detalhe interno: nao pode aparecer na grade nem na exportacao.
    """
    if not schema.names:
        return "*"
    return ", ".join(quote_ident(name) for name in schema.names)
