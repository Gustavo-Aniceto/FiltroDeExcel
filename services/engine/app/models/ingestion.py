"""Contratos do canal interno API -> engine."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ColumnTypeLiteral = Literal["text", "number", "currency", "date", "boolean", "empty"]


class IngestRequest(BaseModel):
    """Pedido de ingestao.

    A API envia CAMINHOS RELATIVOS ao storage, nunca absolutos: o engine resolve
    contra a propria raiz configurada. Aceitar caminho absoluto do chamador
    abriria caminho para leitura arbitraria de arquivos do servidor.
    """

    dataset_id: str = Field(min_length=1, max_length=64)
    original_path: str = Field(min_length=1, max_length=400)
    extension: Literal[".xlsx", ".xls", ".csv"]


class TopValue(BaseModel):
    value: str
    count: int


class ColumnProfileOut(BaseModel):
    name: str
    position: int
    type: ColumnTypeLiteral
    nullCount: int  # noqa: N815 - o contrato JSON e camelCase, alinhado ao frontend
    distinctCount: int  # noqa: N815
    min: float | None = None
    max: float | None = None
    sum: float | None = None
    avg: float | None = None
    minDate: str | None = None  # noqa: N815
    maxDate: str | None = None  # noqa: N815
    topValues: list[TopValue] | None = None  # noqa: N815


class IngestResponse(BaseModel):
    datasetId: str  # noqa: N815
    parquetPath: str  # noqa: N815
    sheetName: str | None  # noqa: N815
    rowCount: int  # noqa: N815
    columnCount: int  # noqa: N815
    duplicateRowCount: int  # noqa: N815
    rowsWithEmptyCount: int  # noqa: N815
    columns: list[ColumnProfileOut]
    durationMs: int  # noqa: N815
