"""Sistema simples de filtragem de planilhas (.xlsx, .xlsm, .csv, .tsv)."""

from .filtros import Condicao, ErroDeFiltro, analisar_condicao
from .motor import Ordenacao, filtrar, ordenar_linhas
from .planilha import ErroDePlanilha, Planilha, escrever, ler

__version__ = "1.0.0"

__all__ = [
    "Condicao",
    "ErroDeFiltro",
    "ErroDePlanilha",
    "Ordenacao",
    "Planilha",
    "analisar_condicao",
    "escrever",
    "filtrar",
    "ler",
    "ordenar_linhas",
    "__version__",
]
