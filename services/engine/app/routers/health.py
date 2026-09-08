"""Endpoints de saude do engine."""

import duckdb
from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness: o processo responde."""
    return {"status": "ok", "service": "excelflow-engine"}


@router.get("/health/ready")
async def ready() -> dict[str, object]:
    """Readiness: as dependencias reais estao utilizaveis.

    Verificamos DuckDB e a escrita no storage porque sao as duas coisas sem as
    quais o engine nao consegue processar nada -- e ambas falham de formas que
    um simples "processo vivo" nao detecta (disco cheio, volume nao montado).
    """
    settings = get_settings()
    checks: dict[str, dict[str, object]] = {}

    try:
        with duckdb.connect(":memory:") as connection:
            connection.execute("SELECT 1").fetchone()
        checks["duckdb"] = {"ok": True, "version": duckdb.__version__}
    except Exception as error:  # noqa: BLE001 - health check reporta qualquer falha
        checks["duckdb"] = {"ok": False, "detail": str(error)}

    try:
        settings.ensure_directories()
        probe = settings.datasets_dir / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        checks["storage"] = {"ok": True, "path": str(settings.storage_root.resolve())}
    except Exception as error:  # noqa: BLE001
        checks["storage"] = {"ok": False, "detail": str(error)}

    all_ok = all(check["ok"] for check in checks.values())
    return {"status": "ready" if all_ok else "degraded", "checks": checks}
