"""Ingestao: planilha enviada -> Parquet + perfil estatistico."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, status

from app.ingestion.inference import coerce_dataframe
from app.ingestion.profiler import profile_dataset, write_parquet
from app.ingestion.reader import IngestionError, read_any
from app.models.ingestion import IngestRequest, IngestResponse
from app.security import require_internal_auth
from app.storage import UnsafePathError, parquet_destination, resolve_within_storage

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal",
    tags=["ingestion"],
    dependencies=[Depends(require_internal_auth)],
)


@router.post("/ingest", response_model=IngestResponse)
async def ingest(request: IngestRequest) -> IngestResponse:
    """Converte a planilha para Parquet e devolve o perfil das colunas.

    O arquivo ORIGINAL nunca e alterado -- apenas lido. Todo o processamento
    produz artefatos novos, o que garante que um erro nosso jamais corrompa o
    arquivo que o usuario enviou.
    """
    started = time.perf_counter()

    try:
        source = resolve_within_storage(request.original_path)
    except UnsafePathError:
        logger.warning("Caminho recusado: %r", request.original_path)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Caminho invalido.")

    if not source.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Arquivo enviado nao encontrado."
        )

    try:
        read_result = read_any(source, request.extension)
        frame, column_types = coerce_dataframe(read_result.frame)
    except IngestionError as error:
        # Erro atribuivel ao ARQUIVO: a mensagem e util e segura para o usuario.
        logger.info("Ingestao recusada para %s: %s", request.dataset_id, error)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))

    if frame.height == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A planilha nao contem nenhuma linha de dados.",
        )

    absolute_parquet, relative_parquet = parquet_destination(request.dataset_id)
    write_parquet(frame, absolute_parquet)

    profile = profile_dataset(absolute_parquet, column_types)
    duration_ms = int((time.perf_counter() - started) * 1000)

    logger.info(
        "Dataset %s ingerido: %d linhas x %d colunas em %d ms",
        request.dataset_id,
        profile["rowCount"],
        profile["columnCount"],
        duration_ms,
    )

    return IngestResponse(
        datasetId=request.dataset_id,
        parquetPath=relative_parquet,
        sheetName=read_result.sheet_name,
        rowCount=profile["rowCount"],
        columnCount=profile["columnCount"],
        duplicateRowCount=profile["duplicateRowCount"],
        rowsWithEmptyCount=profile["rowsWithEmptyCount"],
        columns=profile["columns"],
        durationMs=duration_ms,
    )
