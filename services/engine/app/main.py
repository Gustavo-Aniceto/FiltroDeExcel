"""Ponto de entrada do engine de processamento do ExcelFlow.

O engine e um servico INTERNO. Ele nao conhece usuarios, sessoes nem o banco de
controle: recebe da API caminhos de arquivo e receitas ja validadas, e devolve
resultados. Essa ignorancia e proposital -- e o que permite trata-lo como uma
caixa isolada para o trabalho arriscado de interpretar arquivos nao confiaveis.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.config import get_settings
from app.routers import health, ingestion, query
from app.security import require_internal_auth

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s :: %(message)s",
)
logger = logging.getLogger("excelflow.engine")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.ensure_directories()
    logger.info("Engine iniciado. Storage em %s", settings.storage_root.resolve())
    yield
    logger.info("Engine encerrado.")


app = FastAPI(
    title="ExcelFlow Engine",
    version="0.1.0",
    lifespan=lifespan,
    # Documentacao interativa so fora de producao: em producao ela apenas
    # expoe a superficie da API interna sem beneficio.
    docs_url=None if get_settings().is_production else "/docs",
    redoc_url=None,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Converte excecao inesperada em 500 generico.

    Mensagens de excecao ao processar planilhas frequentemente contem TRECHOS
    DO CONTEUDO do arquivo (valor de celula que falhou na conversao, por
    exemplo). Como as planilhas trazem dados internos da empresa, esse texto
    nao pode atravessar a fronteira do servico. Fica so no log.
    """
    logger.exception("Erro nao tratado em %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Erro interno no motor de processamento."},
    )


# Health e publico dentro da rede interna: um orquestrador precisa consultar a
# saude do container sem carregar segredo.
app.include_router(health.router)

# Todo o restante do engine exige o segredo compartilhado, aplicado como
# dependencia no proprio router.
app.include_router(ingestion.router)
app.include_router(query.router)


@app.get("/internal/ping", dependencies=[Depends(require_internal_auth)])
async def internal_ping() -> dict[str, str]:
    """Confirma que o canal autenticado API -> engine esta funcionando."""
    return {"status": "authenticated"}
