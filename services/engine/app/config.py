"""Configuracao do engine, validada na inicializacao."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# services/engine/app/config.py -> services/engine/app -> engine -> services -> raiz
MONOREPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Le do ambiente e do .env da raiz do monorepo.

    O mesmo arquivo .env configura API, engine e frontend: um unico lugar para
    ajustar a configuracao evita que os tres servicos divirjam silenciosamente
    (por exemplo, com limites de upload diferentes).
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    node_env: str = "development"
    engine_port: int = 8000

    # Segredo compartilhado com a API. O engine NUNCA e exposto publicamente:
    # ele nao tem autenticacao de usuario, apenas este canal interno.
    engine_shared_secret: str

    storage_root: Path = Path("./storage")
    max_upload_bytes: int = 104_857_600
    dataset_ttl_hours: int = 72

    @field_validator("storage_root")
    @classmethod
    def _resolve_storage_root(cls, value: Path) -> Path:
        """Resolve caminho relativo a partir da RAIZ do monorepo.

        Sem isto, `STORAGE_ROOT=./storage` apontaria para `services/engine/storage`
        no engine e para `apps/api/storage` na API -- dois diretorios distintos.
        A API gravaria o upload num lugar e o engine procuraria em outro.
        """
        if value.is_absolute():
            return value
        return (MONOREPO_ROOT / value).resolve()

    @property
    def is_production(self) -> bool:
        return self.node_env == "production"

    @property
    def originals_dir(self) -> Path:
        return self.storage_root / "originals"

    @property
    def datasets_dir(self) -> Path:
        return self.storage_root / "datasets"

    @property
    def exports_dir(self) -> Path:
        return self.storage_root / "exports"

    def ensure_directories(self) -> None:
        for directory in (self.originals_dir, self.datasets_dir, self.exports_dir):
            directory.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
