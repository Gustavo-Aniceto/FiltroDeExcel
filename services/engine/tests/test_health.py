"""Testes das rotas de saude e do canal interno autenticado."""

import os

os.environ.setdefault("ENGINE_SHARED_SECRET", "segredo-de-teste-com-tamanho-ok")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_liveness() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_readiness_checks_duckdb_and_storage() -> None:
    response = client.get("/health/ready")
    body = response.json()
    assert body["checks"]["duckdb"]["ok"] is True
    assert body["checks"]["storage"]["ok"] is True


def test_internal_route_rejects_missing_secret() -> None:
    response = client.get("/internal/ping")
    assert response.status_code == 401


def test_internal_route_rejects_wrong_secret() -> None:
    response = client.get("/internal/ping", headers={"X-Engine-Secret": "errado"})
    assert response.status_code == 401


def test_internal_route_accepts_correct_secret() -> None:
    response = client.get(
        "/internal/ping",
        headers={"X-Engine-Secret": os.environ["ENGINE_SHARED_SECRET"]},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "authenticated"
