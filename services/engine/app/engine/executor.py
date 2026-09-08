"""Execucao de Receitas sobre o Parquet, via DuckDB."""

from __future__ import annotations

import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb

from app.engine.compiler import (
    ROW_ORDER,
    CompilationError,
    CompiledQuery,
    compile_recipe,
    projection_without_row_order,
)
from app.engine.schema import DatasetSchema, SchemaError, quote_ident

logger = logging.getLogger(__name__)

# Teto de memoria do DuckDB. Acima disso ele derrama para disco em vez de
# estourar o processo -- que e exatamente o comportamento desejado numa
# planilha atipicamente grande.
MEMORY_LIMIT = "2GB"

# Coluna sintetica com o total de linhas do resultado.
#
# `COUNT(*) OVER ()` calcula o total na MESMA passada que traz a pagina. A
# alternativa -- uma consulta de contagem separada -- leria o Parquet duas
# vezes e dobraria o custo de cada paginacao.
TOTAL_COLUMN = "__ef_total"


class ExecutionError(ValueError):
    """Falha ao executar a receita. Mensagem segura para o usuario."""


@dataclass
class PageResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    total_rows: int
    input_rows: int
    duration_ms: int


def connect() -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(":memory:")
    connection.execute(f"SET memory_limit = '{MEMORY_LIMIT}'")
    # Sem isto o DuckDB usa todos os nucleos disponiveis. Deixar um livre evita
    # que uma consulta pesada torne o servico inteiro irresponsivo.
    connection.execute("SET threads = 4")
    return connection


def to_json_value(value: Any) -> Any:
    """Normaliza um valor do DuckDB para algo serializavel em JSON.

    Tres armadilhas concretas:
      * NaN e Infinity sao ponto flutuante valido mas JSON invalido -- se
        escapassem, o frontend receberia um payload que nem parseia.
      * Decimal nao e serializavel, e converter para float perderia centavos em
        valores grandes; devolvemos texto, que preserva a precisao exata.
      * datetime precisa virar ISO-8601, e nao a representacao do Python.
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    return value


def _prepare(
    parquet_path: Path,
    schema: DatasetSchema,
    recipe: dict,
) -> CompiledQuery:
    try:
        return compile_recipe(recipe, schema, str(parquet_path))
    except (CompilationError, SchemaError) as error:
        raise ExecutionError(str(error)) from error


def count_input_rows(connection: duckdb.DuckDBPyConnection, parquet_path: Path) -> int:
    row = connection.execute(
        "SELECT COUNT(*) FROM read_parquet(?)", [str(parquet_path)]
    ).fetchone()
    return int(row[0]) if row else 0


def run_page(
    parquet_path: Path,
    schema: DatasetSchema,
    recipe: dict,
    page: int,
    page_size: int,
    search: str | None = None,
) -> PageResult:
    """Executa a receita e devolve UMA pagina de resultado.

    Nunca devolvemos o resultado inteiro: o navegador recebe no maximo
    `page_size` linhas, independentemente de a receita ter selecionado 500 mil.
    """
    started = time.perf_counter()
    compiled = _prepare(parquet_path, schema, recipe)
    projection = projection_without_row_order(compiled.schema)
    params = list(compiled.params)

    # Busca livre sobre o RESULTADO da receita.
    #
    # Concatenamos as colunas em texto e procuramos no todo. Nao e o mais
    # eficiente possivel, mas e o que corresponde a expectativa de quem usa
    # Ctrl+F no Excel -- procurar em tudo de uma vez, sem escolher a coluna.
    where = ""
    if search and compiled.schema.names:
        haystack = " || ' ' || ".join(
            f"COALESCE(CAST({quote_ident(name)} AS VARCHAR), '')"
            for name in compiled.schema.names
        )
        where = f"WHERE LOWER({haystack}) LIKE LOWER(?)"
        params.append(f"%{search}%")

    offset = max(page - 1, 0) * page_size
    sql = (
        f"WITH result AS ({compiled.sql})\n"
        f"SELECT {projection}, COUNT(*) OVER () AS {quote_ident(TOTAL_COLUMN)}\n"
        f"  FROM result {where}\n"
        f" LIMIT {int(page_size)} OFFSET {int(offset)}"
    )

    with connect() as connection:
        try:
            cursor = connection.execute(sql, params)
            records = cursor.fetchall()
            names = [d[0] for d in cursor.description]
        except duckdb.Error as error:
            logger.exception("Falha ao executar receita")
            raise ExecutionError(_friendly_duckdb_error(error)) from error

        total = int(records[0][names.index(TOTAL_COLUMN)]) if records else 0
        if not records and (where or recipe.get("steps")):
            # Resultado vazio e legitimo (o filtro nao casou com nada). O total
            # e zero, mas ainda precisamos das colunas para a grade desenhar o
            # cabecalho em vez de sumir da tela.
            total = 0

        input_rows = count_input_rows(connection, parquet_path)

    visible = [name for name in names if name != TOTAL_COLUMN]
    rows = [
        {name: to_json_value(record[names.index(name)]) for name in visible}
        for record in records
    ]

    return PageResult(
        columns=visible,
        rows=rows,
        total_rows=total,
        input_rows=input_rows,
        duration_ms=int((time.perf_counter() - started) * 1000),
    )


def _friendly_duckdb_error(error: duckdb.Error) -> str:
    """Traduz erro do motor em mensagem util.

    A mensagem crua do DuckDB cita tipos e posicoes internas que nao ajudam
    ninguem. Reconhecemos os casos comuns e explicamos o que fazer.
    """
    raw = str(error)
    text = raw.lower()

    # Coluna ausente e o caso mais comum de todos: acontece sempre que uma
    # receita salva e reaplicada a uma planilha cujo cabecalho mudou. Dizer
    # QUAL coluna falta transforma um beco sem saida em algo acionavel.
    if "not found in from clause" in text or "referenced column" in text:
        match = re.search(r'[Cc]olumn "([^"]+)" not found', raw)
        if match:
            return (
                f'A coluna "{match.group(1)}" nao existe nesta planilha. '
                "Se voce esta reaplicando uma regra salva, verifique se os nomes "
                "das colunas sao os mesmos."
            )
        return "Uma das colunas usadas nas regras nao existe nesta planilha."

    if "conversion" in text or "cast" in text:
        return (
            "Uma das colunas contem valores incompativeis com a operacao pedida. "
            "Verifique se a coluna e realmente numerica ou de data."
        )
    if "out of memory" in text:
        return "A planilha e grande demais para esta operacao."
    return "Nao foi possivel executar as regras sobre esta planilha."


def distinct_values(
    parquet_path: Path,
    schema: DatasetSchema,
    column: str,
    search: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    """Valores distintos de uma coluna, para o autocomplete do filtro.

    Digitar o valor a mao e a principal causa de filtro que "nao retorna nada":
    basta um acento ou espaco a mais. Oferecer a lista elimina a classe inteira
    de erro.
    """
    resolved = schema.resolve(column)
    ident = quote_ident(resolved.name)
    params: list[Any] = [str(parquet_path)]

    condition = f"{ident} IS NOT NULL"
    if search:
        condition += f" AND LOWER(CAST({ident} AS VARCHAR)) LIKE LOWER(?)"
        params.append(f"%{search}%")

    sql = (
        f"SELECT CAST({ident} AS VARCHAR) AS value, COUNT(*) AS total "
        f"  FROM read_parquet(?) WHERE {condition} "
        f" GROUP BY 1 ORDER BY total DESC, value ASC LIMIT {int(limit)}"
    )

    with connect() as connection:
        try:
            records = connection.execute(sql, params).fetchall()
        except duckdb.Error as error:
            raise ExecutionError(_friendly_duckdb_error(error)) from error

    return [{"value": value, "count": int(total)} for value, total in records]


def iter_result_batches(
    connection: duckdb.DuckDBPyConnection,
    compiled: CompiledQuery,
    batch_size: int = 50_000,
):
    """Percorre o resultado em lotes, para exportacao.

    Materializar 500 mil linhas em memoria antes de escrever o arquivo anularia
    toda a economia do plano de dados. `fetchmany` mantem o consumo constante.
    """
    projection = projection_without_row_order(compiled.schema)
    sql = f"WITH result AS ({compiled.sql}) SELECT {projection} FROM result"

    cursor = connection.execute(sql, compiled.params)
    names = [d[0] for d in cursor.description if d[0] != ROW_ORDER]

    yield names, None
    while True:
        batch = cursor.fetchmany(batch_size)
        if not batch:
            break
        yield None, batch


def prepare_for_export(
    parquet_path: Path,
    schema: DatasetSchema,
    recipe: dict,
    columns: list[str] | None,
) -> CompiledQuery:
    """Compila a receita ja aplicando a selecao de colunas da exportacao."""
    effective = dict(recipe)
    if columns:
        # A selecao de colunas do dialogo de exportacao vira mais um passo da
        # receita. Assim ela passa pela MESMA validacao de coluna do resto --
        # nao ha caminho paralelo com regras proprias.
        effective["steps"] = [*(recipe.get("steps") or []), {"kind": "select_columns", "columns": columns}]
    return _prepare(parquet_path, schema, effective)
