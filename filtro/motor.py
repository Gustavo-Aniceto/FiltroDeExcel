"""Aplicação das condições sobre a planilha: filtrar, ordenar e recortar."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from .filtros import Condicao, ErroDeFiltro, como_data, como_numero, comparavel
from .planilha import Planilha

MODOS_E = {"e", "and", "todas", "&&"}
MODOS_OU = {"ou", "or", "qualquer", "||"}


@dataclass(frozen=True)
class Ordenacao:
    """Critério de ordenação: coluna e sentido."""

    coluna: str
    decrescente: bool = False

    @classmethod
    def analisar(cls, texto: str) -> "Ordenacao":
        """Lê ``"Valor:desc"`` ou ``"Nome"`` (crescente por padrão)."""
        bruto = texto.strip()
        if not bruto:
            raise ErroDeFiltro("critério de ordenação vazio")
        coluna, _, sentido = bruto.rpartition(":")
        if not coluna:
            return cls(bruto, False)
        sentido = sentido.strip().lower()
        if sentido in {"desc", "decrescente", "maior", "z-a", "-"}:
            return cls(coluna.strip(), True)
        if sentido in {"asc", "crescente", "menor", "a-z", "+"}:
            return cls(coluna.strip(), False)
        # Não era um sentido: o ":" faz parte do nome da coluna.
        return cls(bruto, False)


def normalizar_modo(modo: str) -> str:
    escolhido = (modo or "e").strip().lower()
    if escolhido in MODOS_E:
        return "e"
    if escolhido in MODOS_OU:
        return "ou"
    raise ErroDeFiltro(f"modo inválido: {modo!r}. Use 'e' (todas) ou 'ou' (qualquer).")


def filtrar(
    planilha: Planilha,
    condicoes: Sequence[Condicao] = (),
    modo: str = "e",
    colunas: Sequence[str] | None = None,
    ordenar: Sequence[Ordenacao] | None = None,
    limite: int | None = None,
    sensivel: bool = False,
    inverter: bool = False,
) -> Planilha:
    """Filtra a planilha e devolve uma nova com o resultado.

    ``modo`` decide se todas as condições precisam passar (``"e"``) ou apenas
    uma (``"ou"``). ``inverter`` devolve exatamente as linhas descartadas.
    """
    modo = normalizar_modo(modo)
    posicoes = {condicao.coluna: planilha.indice(condicao.coluna) for condicao in condicoes}

    linhas = [
        linha
        for linha in planilha.linhas
        if _linha_passa(linha, condicoes, posicoes, modo, sensivel) != inverter
    ]

    resultado = planilha.com_linhas(linhas)
    if ordenar:
        resultado = ordenar_linhas(resultado, ordenar)
    if colunas:
        resultado = resultado.selecionar(list(colunas))
    if limite is not None:
        if limite < 0:
            raise ErroDeFiltro("o limite precisa ser zero ou maior")
        resultado = resultado.com_linhas(resultado.linhas[:limite])
    return resultado


def _linha_passa(
    linha: Sequence[Any],
    condicoes: Sequence[Condicao],
    posicoes: dict[str, int],
    modo: str,
    sensivel: bool,
) -> bool:
    if not condicoes:
        return True
    resultados = (
        condicao.avalia(_celula(linha, posicoes[condicao.coluna]), sensivel)
        for condicao in condicoes
    )
    return all(resultados) if modo == "e" else any(resultados)


def _celula(linha: Sequence[Any], posicao: int) -> Any:
    return linha[posicao] if posicao < len(linha) else None


def ordenar_linhas(planilha: Planilha, criterios: Sequence[Ordenacao]) -> Planilha:
    """Ordena por vários critérios; o primeiro tem prioridade."""
    linhas = list(planilha.linhas)
    # Ordenação estável: aplica os critérios do menos para o mais importante.
    for criterio in reversed(list(criterios)):
        posicao = planilha.indice(criterio.coluna)
        linhas.sort(
            key=lambda linha, posicao=posicao: _chave_de_ordem(_celula(linha, posicao)),
            reverse=criterio.decrescente,
        )
    return planilha.com_linhas(linhas)


def _chave_de_ordem(celula: Any) -> tuple[int, Any]:
    """Ordena números primeiro, depois datas, textos e por fim células vazias."""
    if celula is None or (isinstance(celula, str) and not celula.strip()):
        return (3, "")
    numero = como_numero(celula)
    if numero is not None:
        return (0, numero)
    data = como_data(celula)
    if data is not None:
        return (1, data.timestamp())
    return (2, comparavel(celula))


def resumir(planilha: Planilha, condicoes: Iterable[Condicao], total_original: int) -> str:
    """Frase curta descrevendo o resultado do filtro."""
    regras = [str(condicao) for condicao in condicoes]
    detalhe = f" ({'; '.join(regras)})" if regras else ""
    return f"{len(planilha)} de {total_original} linhas{detalhe}"
