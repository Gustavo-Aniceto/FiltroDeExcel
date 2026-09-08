"""Perfilamento estatistico do dataset, executado sobre o Parquet via DuckDB.

O perfil serve a tres propositos distintos:
  1. Alimentar o dashboard (totais, somas, medias, duplicidades).
  2. Alimentar o construtor de filtros (tipos e valores mais frequentes, para
     o usuario escolher "APROVADO" numa lista em vez de digitar).
  3. Servir de WHITELIST de colunas, o que torna segura a compilacao de SQL
     nas fases seguintes.

Tudo e calculado em consultas agregadas colunares: o Python nunca ve as linhas.
E isso que mantem o consumo de memoria constante em 500 mil linhas.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Any

import duckdb

from app.ingestion.inference import ColumnType

logger = logging.getLogger(__name__)

# Cardinalidade maxima para colecionar valores mais frequentes. Acima disso a
# lista deixaria de ser util na interface (ninguem escolhe numa lista de 5 mil
# itens) e so pesaria o payload.
TOP_VALUES_MAX_DISTINCT = 60
TOP_VALUES_LIMIT = 15
# Teto de colunas que recebem coleta de valores frequentes, para nao disparar
# dezenas de consultas extras numa planilha muito larga.
TOP_VALUES_MAX_COLUMNS = 40

NUMERIC_TYPES: frozenset[ColumnType] = frozenset({"number", "currency"})


def quote_ident(name: str) -> str:
    """Escapa um identificador SQL.

    Os nomes vem do cabecalho da planilha, entao contem acentos, espacos e
    parenteses. Aspas duplas com duplicacao interna e o escape correto e
    suficiente -- e o nome NUNCA e concatenado sem passar por aqui.
    """
    return '"' + name.replace('"', '""') + '"'


def _finite(value: Any) -> float | None:
    """Normaliza numeros para JSON.

    NaN e Infinity sao validos em ponto flutuante mas invalidos em JSON: se
    escapassem, o frontend receberia um payload que nem parseia.
    """
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


def profile_dataset(
    parquet_path: Path,
    column_types: dict[str, ColumnType],
) -> dict[str, Any]:
    """Calcula o perfil completo do dataset."""
    columns = list(column_types.keys())
    source = f"read_parquet({str(parquet_path)!r})"

    with duckdb.connect(":memory:") as connection:
        # DuckDB e single-file e roda in-process; limitar memoria evita que uma
        # planilha atipica derrube o servico inteiro.
        connection.execute("SET memory_limit = '2GB'")
        connection.execute(f"CREATE VIEW ds AS SELECT * FROM {source}")

        row_count = connection.execute("SELECT COUNT(*) FROM ds").fetchone()[0]

        stats = _column_statistics(connection, columns, column_types, row_count)
        duplicate_rows, rows_with_empty = _row_level_counts(connection, columns, row_count)
        _attach_top_values(connection, stats, column_types, row_count)

    return {
        "rowCount": row_count,
        "columnCount": len(columns),
        "duplicateRowCount": duplicate_rows,
        "rowsWithEmptyCount": rows_with_empty,
        "columns": [stats[name] for name in columns],
    }


def _column_statistics(
    connection: duckdb.DuckDBPyConnection,
    columns: list[str],
    column_types: dict[str, ColumnType],
    row_count: int,
) -> dict[str, dict[str, Any]]:
    """Agrega todas as colunas numa UNICA consulta.

    Uma consulta por coluna significaria N leituras do arquivo. Montando um
    unico SELECT com todas as agregacoes, o DuckDB le o Parquet uma vez so e
    ainda aplica projection pushdown por coluna.
    """
    if not columns:
        return {}

    selects: list[str] = []
    for index, name in enumerate(columns):
        ident = quote_ident(name)
        kind = column_types[name]
        selects.append(f"COUNT({ident}) AS c{index}_nonnull")
        selects.append(f"COUNT(DISTINCT {ident}) AS c{index}_distinct")

        if kind in NUMERIC_TYPES:
            selects.append(f"MIN({ident})::DOUBLE AS c{index}_min")
            selects.append(f"MAX({ident})::DOUBLE AS c{index}_max")
            selects.append(f"SUM({ident})::DOUBLE AS c{index}_sum")
            selects.append(f"AVG({ident})::DOUBLE AS c{index}_avg")
        elif kind == "date":
            selects.append(f"MIN({ident}) AS c{index}_mindate")
            selects.append(f"MAX({ident}) AS c{index}_maxdate")

    row = connection.execute(f"SELECT {', '.join(selects)} FROM ds").fetchone()
    values = dict(zip([d[0] for d in connection.description], row))

    stats: dict[str, dict[str, Any]] = {}
    for index, name in enumerate(columns):
        kind = column_types[name]
        non_null = values.get(f"c{index}_nonnull") or 0
        entry: dict[str, Any] = {
            "name": name,
            "position": index,
            "type": kind,
            "nullCount": row_count - non_null,
            "distinctCount": values.get(f"c{index}_distinct") or 0,
        }

        if kind in NUMERIC_TYPES:
            entry["min"] = _finite(values.get(f"c{index}_min"))
            entry["max"] = _finite(values.get(f"c{index}_max"))
            entry["sum"] = _finite(values.get(f"c{index}_sum"))
            entry["avg"] = _finite(values.get(f"c{index}_avg"))
        elif kind == "date":
            entry["minDate"] = _iso(values.get(f"c{index}_mindate"))
            entry["maxDate"] = _iso(values.get(f"c{index}_maxdate"))

        stats[name] = entry

    return stats


def _row_level_counts(
    connection: duckdb.DuckDBPyConnection,
    columns: list[str],
    row_count: int,
) -> tuple[int, int]:
    """Conta linhas duplicadas e linhas com alguma celula vazia.

    "Duplicadas" aqui sao as ocorrencias EXCEDENTES: tres linhas identicas
    contam como duas duplicatas, nao tres. E o numero que responde a pergunta
    do usuario -- "quantas linhas eu removeria?".
    """
    if row_count == 0 or not columns:
        return 0, 0

    distinct_rows = connection.execute(
        "SELECT COUNT(*) FROM (SELECT DISTINCT * FROM ds)"
    ).fetchone()[0]
    duplicate_rows = max(row_count - distinct_rows, 0)

    null_predicate = " OR ".join(f"{quote_ident(name)} IS NULL" for name in columns)
    rows_with_empty = connection.execute(
        f"SELECT COUNT(*) FROM ds WHERE {null_predicate}"
    ).fetchone()[0]

    return duplicate_rows, rows_with_empty


def _attach_top_values(
    connection: duckdb.DuckDBPyConnection,
    stats: dict[str, dict[str, Any]],
    column_types: dict[str, ColumnType],
    row_count: int,
) -> None:
    """Coleta valores mais frequentes das colunas categoricas.

    E o que permite ao construtor de filtros oferecer "APROVADO / PENDENTE /
    RECUSADO" numa lista. Digitar o valor a mao e a principal fonte de filtro
    que "nao retorna nada" por causa de um acento ou espaco a mais.
    """
    if row_count == 0:
        return

    candidates = [
        name
        for name, entry in stats.items()
        if column_types[name] in ("text", "boolean")
        and 0 < entry["distinctCount"] <= TOP_VALUES_MAX_DISTINCT
    ][:TOP_VALUES_MAX_COLUMNS]

    for name in candidates:
        ident = quote_ident(name)
        rows = connection.execute(
            f"""
            SELECT CAST({ident} AS VARCHAR) AS value, COUNT(*) AS total
              FROM ds
             WHERE {ident} IS NOT NULL
             GROUP BY 1
             ORDER BY total DESC, value ASC
             LIMIT {TOP_VALUES_LIMIT}
            """
        ).fetchall()
        stats[name]["topValues"] = [{"value": value, "count": total} for value, total in rows]


def write_parquet(frame: Any, destination: Path) -> None:
    """Grava o DataFrame como Parquet comprimido.

    zstd comprime melhor que snappy com custo de CPU comparavel na escrita, e
    descomprime rapido -- o perfil certo para um arquivo escrito uma vez e lido
    muitas.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    frame.write_parquet(destination, compression="zstd", statistics=True)
