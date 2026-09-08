# ============================================================================
# Engine de processamento (Python + FastAPI + DuckDB + Polars)
# ============================================================================
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# requirements.txt copiado sozinho: enquanto as dependencias nao mudarem, o
# Docker reaproveita esta camada -- a mais cara da imagem (DuckDB, Polars e
# PyArrow somam centenas de MB).
COPY services/engine/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/engine/app ./app

RUN useradd --uid 1001 --create-home excelflow \
 && mkdir -p /data && chown -R excelflow:excelflow /app /data
USER excelflow

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
