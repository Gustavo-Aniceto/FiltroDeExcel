"""Gera exemplos/vendas.xlsx a partir de exemplos/vendas.csv.

Uso: python exemplos/gerar_planilha_exemplo.py
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from filtro.planilha import escrever, ler  # noqa: E402

PASTA = Path(__file__).resolve().parent
NUMERICAS = {"ID", "Quantidade", "Valor"}


def converter(coluna: str, valor: str):
    """Transforma o texto do CSV em número/data para o arquivo Excel."""
    if coluna in NUMERICAS:
        return float(valor.replace(".", "").replace(",", "."))
    if coluna == "Data":
        return datetime.strptime(valor, "%Y-%m-%d")
    return valor


def main() -> int:
    planilha = ler(PASTA / "vendas.csv")
    planilha.nome = "Vendas"
    planilha.linhas = [
        [converter(coluna, celula) for coluna, celula in zip(planilha.colunas, linha)]
        for linha in planilha.linhas
    ]
    destino = escrever(planilha, PASTA / "vendas.xlsx")
    print(f"{len(planilha)} linhas gravadas em {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
