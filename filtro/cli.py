"""Interface de linha de comando do filtro de planilhas."""

from __future__ import annotations

import argparse
import sys
from typing import Any, Sequence

from . import __version__
from .filtros import ALIASES, ErroDeFiltro, analisar_condicao, como_numero, esta_vazio
from .motor import Ordenacao, filtrar, resumir
from .planilha import ErroDePlanilha, Planilha, escrever, ler, _texto

LARGURA_MAXIMA = 32

EXEMPLOS = """\
exemplos:
  filtro-planilha vendas.xlsx --onde "Cidade = São Paulo"
  filtro-planilha vendas.xlsx --onde "Valor > 1000" --onde "Status contem pago" -o resultado.xlsx
  filtro-planilha vendas.csv --onde "Estado em SP;RJ;MG" --modo ou --ordenar "Valor:desc" --limite 10
  filtro-planilha vendas.xlsx --onde "Data entre 2024-01-01 e 2024-03-31" -c Cliente,Valor,Data
  filtro-planilha vendas.xlsx --listar-colunas
"""


def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="filtro-planilha",
        description="Filtra linhas de uma planilha (.xlsx, .xlsm, .csv, .tsv) por condições simples.",
        epilog=EXEMPLOS + "\n" + _ajuda_operadores(),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("entrada", help="arquivo da planilha a ser filtrada")
    parser.add_argument(
        "-w",
        "--onde",
        dest="condicoes",
        action="append",
        default=[],
        metavar="CONDICAO",
        help='condição no formato "coluna operador valor" (pode repetir)',
    )
    parser.add_argument(
        "-m",
        "--modo",
        default="e",
        help="'e' exige todas as condições (padrão), 'ou' exige pelo menos uma",
    )
    parser.add_argument(
        "--inverter",
        action="store_true",
        help="devolve as linhas que NÃO passaram nas condições",
    )
    parser.add_argument(
        "-c",
        "--colunas",
        action="append",
        default=[],
        metavar="LISTA",
        help="colunas a manter na saída, separadas por vírgula (pode repetir)",
    )
    parser.add_argument(
        "-s",
        "--ordenar",
        action="append",
        default=[],
        metavar="COLUNA[:asc|desc]",
        help="ordena o resultado pela coluna indicada (pode repetir)",
    )
    parser.add_argument("-n", "--limite", type=int, metavar="N", help="mantém apenas as N primeiras linhas")
    parser.add_argument("-o", "--saida", metavar="ARQUIVO", help="grava o resultado neste arquivo")
    parser.add_argument("--aba", help="nome ou número da aba do Excel (padrão: a primeira)")
    parser.add_argument(
        "--linha-cabecalho",
        type=int,
        default=1,
        metavar="N",
        help="linha que contém os títulos das colunas (padrão: 1)",
    )
    parser.add_argument("--delimitador", help="separador usado ao gravar arquivos de texto (padrão: o mesmo da entrada)")
    parser.add_argument(
        "--sensivel",
        action="store_true",
        help="diferencia maiúsculas e acentos nas comparações de texto",
    )
    parser.add_argument("--listar-colunas", action="store_true", help="apenas mostra as colunas do arquivo e sai")
    parser.add_argument("--contar", action="store_true", help="apenas mostra quantas linhas passaram no filtro")
    parser.add_argument(
        "--max-linhas",
        type=int,
        default=20,
        metavar="N",
        help="linhas exibidas na prévia quando não há arquivo de saída (padrão: 20)",
    )
    parser.add_argument("--versao", action="version", version=f"%(prog)s {__version__}")
    return parser


def _ajuda_operadores() -> str:
    linhas = ["operadores:"]
    for nome, aliases in ALIASES.items():
        grafias = ", ".join(aliases)
        linhas.append(f"  {nome:<12} {grafias}")
    linhas.append("  'entre' aceita 'entre 10 e 20'; 'em' aceita 'em SP;RJ;MG'")
    return "\n".join(linhas)


def main(argv: Sequence[str] | None = None) -> int:
    parser = construir_parser()
    args = parser.parse_args(argv)
    try:
        return _executar(args)
    except (ErroDePlanilha, ErroDeFiltro) as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 2


def _executar(args: argparse.Namespace) -> int:
    planilha = ler(args.entrada, aba=args.aba, linha_cabecalho=args.linha_cabecalho)

    if args.listar_colunas:
        print(f"{args.entrada} — aba {planilha.nome} — {len(planilha)} linhas")
        for posicao, coluna in enumerate(planilha.colunas, start=1):
            print(f"  {posicao:>2}. {coluna}")
        return 0

    condicoes = [analisar_condicao(texto) for texto in args.condicoes]
    colunas = _dividir_colunas(args.colunas)
    criterios = [Ordenacao.analisar(texto) for texto in args.ordenar]

    resultado = filtrar(
        planilha,
        condicoes,
        modo=args.modo,
        colunas=colunas,
        ordenar=criterios,
        limite=args.limite,
        sensivel=args.sensivel,
        inverter=args.inverter,
    )

    if args.contar:
        print(len(resultado))
        return 0

    if args.saida:
        destino = escrever(resultado, args.saida, delimitador=args.delimitador)
        print(f"{resumir(resultado, condicoes, len(planilha))} → {destino}")
        return 0

    if resultado.linhas:
        print(formatar_tabela(resultado, args.max_linhas))
    print(resumir(resultado, condicoes, len(planilha)))
    if not resultado.linhas:
        print("nenhuma linha passou no filtro.")
    return 0


def _dividir_colunas(valores: Sequence[str]) -> list[str]:
    colunas: list[str] = []
    for valor in valores:
        colunas.extend(parte.strip() for parte in valor.split(",") if parte.strip())
    return colunas


def formatar_tabela(planilha: Planilha, max_linhas: int = 20) -> str:
    """Monta uma tabela de texto alinhada para a prévia no terminal."""
    visiveis = planilha.linhas if max_linhas is None or max_linhas < 0 else planilha.linhas[:max_linhas]
    cabecalho = [_encurtar(coluna) for coluna in planilha.colunas]
    corpo = [[_encurtar(_texto(celula)) for celula in linha] for linha in visiveis]

    larguras = [len(titulo) for titulo in cabecalho]
    for linha in corpo:
        for posicao, celula in enumerate(linha):
            larguras[posicao] = max(larguras[posicao], len(celula))
    a_direita = _colunas_numericas(visiveis, len(cabecalho))

    partes = [
        _montar_linha(cabecalho, larguras, a_direita),
        "  ".join("-" * largura for largura in larguras),
    ]
    for linha in corpo:
        partes.append(_montar_linha(linha, larguras, a_direita))
    ocultas = len(planilha.linhas) - len(visiveis)
    if ocultas > 0:
        partes.append(f"... (+{ocultas} linhas; use --max-linhas ou --saida para ver todas)")
    return "\n".join(partes)


def _colunas_numericas(linhas: Sequence[Sequence[Any]], total: int) -> list[bool]:
    """Marca as colunas em que todos os valores preenchidos são números."""
    marcas = []
    for posicao in range(total):
        valores = [linha[posicao] for linha in linhas if posicao < len(linha)]
        preenchidos = [valor for valor in valores if not esta_vazio(valor)]
        marcas.append(bool(preenchidos) and all(como_numero(valor) is not None for valor in preenchidos))
    return marcas


def _montar_linha(celulas: Sequence[str], larguras: Sequence[int], a_direita: Sequence[bool]) -> str:
    formatadas = [
        celula.rjust(largura) if direita else celula.ljust(largura)
        for celula, largura, direita in zip(celulas, larguras, a_direita)
    ]
    return "  ".join(formatadas).rstrip()


def _encurtar(texto: str) -> str:
    return texto if len(texto) <= LARGURA_MAXIMA else texto[: LARGURA_MAXIMA - 1] + "…"


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
