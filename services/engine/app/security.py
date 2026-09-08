"""Autenticacao do canal interno API -> engine."""

import hmac

from fastapi import Header, HTTPException, status

from app.config import get_settings


async def require_internal_auth(
    x_engine_secret: str | None = Header(default=None, alias="X-Engine-Secret"),
) -> None:
    """Valida o segredo compartilhado enviado pela API.

    A comparacao usa `hmac.compare_digest`, nao `==`: comparacao de string
    normal encerra no primeiro byte diferente, e essa diferenca de tempo
    permite descobrir o segredo byte a byte.

    Esta e a UNICA barreira do engine. Ele deve permanecer em rede interna, sem
    porta publicada -- o segredo e defesa em profundidade, nao a defesa
    principal.
    """
    settings = get_settings()

    if x_engine_secret is None or not hmac.compare_digest(
        x_engine_secret, settings.engine_shared_secret
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credencial interna invalida.",
        )
