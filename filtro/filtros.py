"""Condições de filtro: operadores, conversões e leitura da sintaxe textual.

Uma condição é escrita como ``coluna operador valor``, por exemplo::

    Cidade = São Paulo
    Valor > 1000
    Status contem pend
    Data entre 2024-01-01 e 2024-03-31
    Observação vazio
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Callable

from .planilha import _texto


class ErroDeFiltro(Exception):
    """Condição de filtro inválida."""


# Cada operador aceita várias grafias; a primeira é a forma canônica.
ALIASES: dict[str, tuple[str, ...]] = {
    "igual": ("=", "==", "igual"),
    "diferente": ("!=", "<>", "diferente"),
    "maior": (">", "maior"),
    "maior_igual": (">=", "maior_igual"),
    "menor": ("<", "menor"),
    "menor_igual": ("<=", "menor_igual"),
    "contem": ("contem",),
    "nao_contem": ("nao_contem",),
    "comeca_com": ("comeca_com",),
    "termina_com": ("termina_com",),
    "entre": ("entre",),
    "em": ("em",),
    "vazio": ("vazio",),
    "nao_vazio": ("nao_vazio",),
}

SEM_VALOR = {"vazio", "nao_vazio"}

_CANONICO = {alias: nome for nome, aliases in ALIASES.items() for alias in aliases}

# Operadores escritos por extenso, dos mais longos para os mais curtos para que
# "nao contem" seja reconhecido antes de "contem".
_PALAVRAS = [
    "nao[ _]contem",
    "nao[ _]vazio",
    "comeca[ _]com",
    "termina[ _]com",
    "maior[ _]igual",
    "menor[ _]igual",
    "contem",
    "diferente",
    "igual",
    "maior",
    "menor",
    "entre",
    "vazio",
    "em",
]
_REGEX_PALAVRA = re.compile(r"(?<![\w])(" + "|".join(_PALAVRAS) + r")(?![\w])")
_REGEX_SIMBOLO = re.compile(r"(>=|<=|<>|!=|==|=|>|<)")

_FORMATOS_DE_DATA = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%Y/%m/%d",
    "%d/%m/%y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
)


def dobrar(texto: str) -> str:
    """Minúsculas e sem acentos, preservando o tamanho original do texto."""
    saida = []
    for caractere in texto:
        decomposto = unicodedata.normalize("NFD", caractere)
        base = "".join(c for c in decomposto if not unicodedata.combining(c))
        saida.append(base if len(base) == 1 else caractere)
    return "".join(saida).lower()


def comparavel(valor: Any, sensivel: bool = False) -> str:
    """Texto pronto para comparação (opcionalmente respeitando caixa e acentos)."""
    texto = _texto(valor).strip()
    if sensivel:
        return texto
    return " ".join(dobrar(texto).split())


def como_numero(valor: Any) -> float | None:
    """Tenta interpretar ``valor`` como número, aceitando ``1.234,56`` e ``R$ 10``."""
    if isinstance(valor, bool) or valor is None:
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).strip()
    if not texto:
        return None
    texto = re.sub(r"[R$€£%\s ]", "", texto)
    if not texto:
        return None
    negativo = texto.startswith("(") and texto.endswith(")")
    if negativo:
        texto = texto[1:-1]
    if "," in texto and "." in texto:
        # O separador decimal é o último que aparece.
        if texto.rfind(",") > texto.rfind("."):
            texto = texto.replace(".", "").replace(",", ".")
        else:
            texto = texto.replace(",", "")
    elif "," in texto:
        texto = texto.replace(",", ".")
    elif texto.count(".") > 1:
        texto = texto.replace(".", "")
    try:
        numero = float(texto)
    except ValueError:
        return None
    return -numero if negativo else numero


def como_data(valor: Any) -> datetime | None:
    """Tenta interpretar ``valor`` como data (aceita ISO e dd/mm/aaaa)."""
    if isinstance(valor, datetime):
        return valor
    if isinstance(valor, date):
        return datetime(valor.year, valor.month, valor.day)
    if not isinstance(valor, str):
        return None
    texto = valor.strip()
    if not texto:
        return None
    for formato in _FORMATOS_DE_DATA:
        try:
            return datetime.strptime(texto, formato)
        except ValueError:
            continue
    return None


def _par_comparavel(celula: Any, referencia: Any, sensivel: bool) -> tuple[Any, Any]:
    """Escolhe a melhor forma de comparar duas células: número, data ou texto."""
    numero_celula, numero_referencia = como_numero(celula), como_numero(referencia)
    if numero_celula is not None and numero_referencia is not None:
        return numero_celula, numero_referencia
    data_celula, data_referencia = como_data(celula), como_data(referencia)
    if data_celula is not None and data_referencia is not None:
        return data_celula, data_referencia
    return comparavel(celula, sensivel), comparavel(referencia, sensivel)


def esta_vazio(celula: Any) -> bool:
    return celula is None or (isinstance(celula, str) and not celula.strip())


def _dividir_intervalo(valor: str) -> tuple[str, str]:
    for separador in (r"\.\.", r"\s+e\s+", ";"):
        partes = re.split(separador, valor, maxsplit=1)
        if len(partes) == 2:
            return partes[0].strip(), partes[1].strip()
    raise ErroDeFiltro(
        f"o operador 'entre' precisa de dois valores (ex.: 'entre 10 e 20'), recebi {valor!r}"
    )


def _dividir_lista(valor: str) -> list[str]:
    separador = ";" if ";" in valor else ","
    itens = [item.strip() for item in valor.split(separador)]
    return [item for item in itens if item]


def _igual(celula: Any, valor: str, sensivel: bool) -> bool:
    a, b = _par_comparavel(celula, valor, sensivel)
    return a == b


def _maior(celula, valor, sensivel):
    a, b = _par_comparavel(celula, valor, sensivel)
    return a > b


def _maior_igual(celula, valor, sensivel):
    a, b = _par_comparavel(celula, valor, sensivel)
    return a >= b


def _menor(celula, valor, sensivel):
    a, b = _par_comparavel(celula, valor, sensivel)
    return a < b


def _menor_igual(celula, valor, sensivel):
    a, b = _par_comparavel(celula, valor, sensivel)
    return a <= b


def _entre(celula, valor, sensivel):
    inicio, fim = _dividir_intervalo(valor)
    return _maior_igual(celula, inicio, sensivel) and _menor_igual(celula, fim, sensivel)


def _em(celula, valor, sensivel):
    return any(_igual(celula, item, sensivel) for item in _dividir_lista(valor))


TESTES: dict[str, Callable[[Any, str, bool], bool]] = {
    "igual": _igual,
    "diferente": lambda celula, valor, sensivel: not _igual(celula, valor, sensivel),
    "maior": _maior,
    "maior_igual": _maior_igual,
    "menor": _menor,
    "menor_igual": _menor_igual,
    "contem": lambda celula, valor, sensivel: comparavel(valor, sensivel) in comparavel(celula, sensivel),
    "nao_contem": lambda celula, valor, sensivel: comparavel(valor, sensivel) not in comparavel(celula, sensivel),
    "comeca_com": lambda celula, valor, sensivel: comparavel(celula, sensivel).startswith(comparavel(valor, sensivel)),
    "termina_com": lambda celula, valor, sensivel: comparavel(celula, sensivel).endswith(comparavel(valor, sensivel)),
    "entre": _entre,
    "em": _em,
    "vazio": lambda celula, valor, sensivel: esta_vazio(celula),
    "nao_vazio": lambda celula, valor, sensivel: not esta_vazio(celula),
}


@dataclass(frozen=True)
class Condicao:
    """Uma regra de filtro aplicada a uma coluna."""

    coluna: str
    operador: str
    valor: str = ""

    def __post_init__(self) -> None:
        if self.operador not in TESTES:
            conhecidos = ", ".join(sorted(TESTES))
            raise ErroDeFiltro(f"operador desconhecido: {self.operador!r}. Use um destes: {conhecidos}")
        if self.operador not in SEM_VALOR and not str(self.valor).strip():
            raise ErroDeFiltro(f"o operador {self.operador!r} precisa de um valor de comparação")

    def avalia(self, celula: Any, sensivel: bool = False) -> bool:
        """Aplica a condição a uma célula."""
        if self.operador not in SEM_VALOR and esta_vazio(celula):
            # Célula vazia só passa em testes que a mencionam explicitamente.
            return self.operador in {"diferente", "nao_contem"}
        return TESTES[self.operador](celula, self.valor, sensivel)

    def __str__(self) -> str:
        return f"{self.coluna} {self.operador} {self.valor}".strip()


def normalizar_operador(texto: str) -> str:
    """Converte qualquer grafia aceita para o nome canônico do operador."""
    bruto = dobrar(texto.strip())
    if bruto in _CANONICO:
        return _CANONICO[bruto]
    normalizado = re.sub(r"[\s_]+", "_", bruto)
    if normalizado in _CANONICO:
        return _CANONICO[normalizado]
    conhecidos = ", ".join(sorted(TESTES))
    raise ErroDeFiltro(f"operador desconhecido: {texto!r}. Use um destes: {conhecidos}")


def analisar_condicao(texto: str) -> Condicao:
    """Lê uma condição escrita como texto: ``"Valor >= 1000"``.

    O nome da coluna pode vir entre aspas quando contiver um operador,
    por exemplo ``'"Item em estoque" = sim'``.
    """
    original = texto.strip()
    if not original:
        raise ErroDeFiltro("condição vazia")

    coluna_citada = None
    resto = original
    if original[0] in "\"'":
        fecha = original.find(original[0], 1)
        if fecha == -1:
            raise ErroDeFiltro(f"aspas não fechadas em {original!r}")
        coluna_citada = original[1:fecha]
        resto = original[fecha + 1 :]

    inicio, fim = _localizar_operador(resto)
    if inicio is None:
        raise ErroDeFiltro(
            f"não encontrei um operador em {original!r}. "
            "Escreva algo como 'Cidade = São Paulo' ou 'Valor > 1000'."
        )

    coluna = coluna_citada if coluna_citada is not None else resto[:inicio].strip()
    operador = normalizar_operador(resto[inicio:fim])
    valor = resto[fim:].strip()

    if not coluna:
        raise ErroDeFiltro(f"faltou o nome da coluna em {original!r}")
    if operador in SEM_VALOR and valor:
        raise ErroDeFiltro(f"o operador {operador!r} não aceita valor, mas recebi {valor!r}")
    return Condicao(coluna, operador, _sem_aspas(valor))


def _localizar_operador(texto: str) -> tuple[int | None, int | None]:
    """Devolve o trecho do primeiro operador encontrado (palavra ou símbolo)."""
    dobrado = dobrar(texto)
    candidatos = []
    for regex in (_REGEX_PALAVRA, _REGEX_SIMBOLO):
        encontrado = regex.search(dobrado)
        if encontrado:
            candidatos.append(encontrado)
    if not candidatos:
        return None, None
    # O operador mais à esquerda vence; em empate, o mais longo.
    melhor = min(candidatos, key=lambda m: (m.start(), -(m.end() - m.start())))
    return melhor.start(), melhor.end()


def _sem_aspas(valor: str) -> str:
    if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
        return valor[1:-1]
    return valor
