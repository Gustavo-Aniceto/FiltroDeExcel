"""Resolucao segura de caminhos dentro do storage."""

from __future__ import annotations

from pathlib import Path

from app.config import get_settings


class UnsafePathError(ValueError):
    """Caminho que escaparia da raiz do storage."""


def resolve_within_storage(relative_path: str) -> Path:
    """Resolve um caminho relativo garantindo que ele permanece no storage.

    Sem esta verificacao, um `original_path` como "../../etc/passwd" faria o
    engine ler um arquivo arbitrario do servidor. Resolvemos o caminho ate o
    fim (o que elimina `..` e links simbolicos) e conferimos que o resultado
    ainda esta sob a raiz -- checar apenas a string permitiria escapar via
    symlink.
    """
    settings = get_settings()
    root = settings.storage_root.resolve()
    candidate = (root / relative_path).resolve()

    if not candidate.is_relative_to(root):
        raise UnsafePathError(f"Caminho fora do storage: {relative_path}")

    return candidate


def parquet_destination(dataset_id: str) -> tuple[Path, str]:
    """Caminho absoluto e relativo do Parquet de um dataset."""
    settings = get_settings()
    relative = f"datasets/{dataset_id}.parquet"
    return (settings.storage_root / relative), relative
