"""Rotas de execucao de Receitas: previa, analises e exportacao."""

from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.engine.executor import ExecutionError, distinct_values, run_page
from app.engine.metrics import compute_metrics, suggest_metrics
from app.engine.schema import DatasetSchema, SchemaError
from app.export.writer import export_result
from app.models.ingestion import ColumnTypeLiteral
from app.security import require_internal_auth
from app.storage import UnsafePathError, resolve_within_storage

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal",
    tags=["query"],
    dependencies=[Depends(require_internal_auth)],
)

MAX_PAGE_SIZE = 500


class ColumnRef(BaseModel):
    name: str
    type: ColumnTypeLiteral


class BaseQueryRequest(BaseModel):
    """Base das requisicoes do canal interno.

    A API envia o ESQUEMA junto com a requisicao, lido da tabela
    `dataset_columns`. O engine nao consulta o SQL Server -- ele nem tem
    credencial de banco. Isso mantem o servico que interpreta arquivos nao
    confiaveis isolado do plano de controle.
    """

    parquet_path: str = Field(min_length=1, max_length=400)
    columns: list[ColumnRef]
    recipe: dict[str, Any] = Field(default_factory=lambda: {"version": 1, "steps": [], "metrics": []})


def _schema_of(request: BaseQueryRequest) -> DatasetSchema:
    return DatasetSchema.from_pairs([(c.name, c.type) for c in request.columns])


def _parquet_of(request: BaseQueryRequest) -> Path:
    try:
        path = resolve_within_storage(request.parquet_path)
    except UnsafePathError:
        logger.warning("Caminho recusado: %r", request.parquet_path)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Caminho invalido.")

    if not path.is_file():
        # Acontece de verdade quando o dataset expirou por TTL e os arquivos ja
        # foram apagados. A mensagem precisa dizer isso, nao "arquivo ausente".
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Os dados desta planilha nao estao mais disponiveis. Envie o arquivo novamente.",
        )
    return path


class PreviewRequest(BaseQueryRequest):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=MAX_PAGE_SIZE)
    search: str | None = Field(default=None, max_length=200)
    metrics: list[dict[str, Any]] = Field(default_factory=list)


class PreviewResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    totalRows: int  # noqa: N815 - contrato JSON em camelCase, alinhado ao frontend
    inputRows: int  # noqa: N815
    metrics: list[dict[str, Any]]
    durationMs: int  # noqa: N815


@router.post("/preview", response_model=PreviewResponse)
async def preview(request: PreviewRequest) -> PreviewResponse:
    """Executa a receita e devolve uma pagina do resultado mais as analises.

    Linhas e metricas voltam JUNTAS de proposito: a tela de resultado precisa
    das duas, e separar em dois endpoints dobraria as viagens de rede a cada
    ajuste de filtro -- justamente o momento em que a resposta precisa ser
    imediata.
    """
    started = time.perf_counter()
    parquet = _parquet_of(request)
    schema = _schema_of(request)

    try:
        page = run_page(
            parquet, schema, request.recipe,
            request.page, request.page_size, request.search,
        )
        metrics = compute_metrics(parquet, schema, request.recipe, request.metrics)
    except (ExecutionError, SchemaError) as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))

    return PreviewResponse(
        columns=page.columns,
        rows=page.rows,
        totalRows=page.total_rows,
        inputRows=page.input_rows,
        metrics=metrics,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


class ValuesRequest(BaseQueryRequest):
    column: str = Field(min_length=1, max_length=255)
    search: str | None = Field(default=None, max_length=200)
    limit: int = Field(default=50, ge=1, le=200)


@router.post("/column-values")
async def column_values(request: ValuesRequest) -> dict[str, Any]:
    """Valores distintos de uma coluna, para o construtor de filtros."""
    parquet = _parquet_of(request)
    schema = _schema_of(request)
    try:
        return {"values": distinct_values(parquet, schema, request.column, request.search, request.limit)}
    except (ExecutionError, SchemaError) as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))


@router.post("/suggested-metrics")
async def suggested(request: BaseQueryRequest) -> dict[str, Any]:
    """Analises iniciais sugeridas conforme as colunas da planilha."""
    return {"metrics": suggest_metrics(_schema_of(request))}


class ExportRequest(BaseQueryRequest):
    fmt: Literal["xlsx", "csv"] = "xlsx"
    export_columns: list[str] | None = None
    summary: list[dict[str, Any]] | None = None
    source_name: str = "planilha"


class ExportResponse(BaseModel):
    path: str
    rowCount: int  # noqa: N815
    sizeBytes: int  # noqa: N815
    columns: list[str]
    durationMs: int  # noqa: N815


@router.post("/export", response_model=ExportResponse)
async def export(request: ExportRequest) -> ExportResponse:
    """Gera o arquivo de resultado no storage e devolve o caminho relativo."""
    started = time.perf_counter()
    parquet = _parquet_of(request)
    schema = _schema_of(request)

    settings = get_settings()
    relative = f"exports/{uuid.uuid4()}.{request.fmt}"
    destination = settings.storage_root / relative

    try:
        written, columns = export_result(
            destination=destination,
            parquet_path=parquet,
            schema=schema,
            recipe=request.recipe,
            fmt=request.fmt,
            columns=request.export_columns,
            summary=request.summary,
            source_name=request.source_name,
        )
    except (ExecutionError, SchemaError) as error:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    except Exception:
        # Um arquivo parcial no storage seria baixado como se estivesse
        # completo. Melhor nao existir.
        destination.unlink(missing_ok=True)
        raise

    return ExportResponse(
        path=relative,
        rowCount=written,
        sizeBytes=destination.stat().st_size,
        columns=columns,
        durationMs=int((time.perf_counter() - started) * 1000),
    )
