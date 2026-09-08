"""Inferencia de tipos de coluna.

O problema real: uma planilha exportada de sistema legado traz numeros e datas
como TEXTO, no formato brasileiro. A coluna "Valor da operacao" chega como
"R$ 1.234,56" e a coluna "Data" como "01/09/2026". Se tratarmos essas colunas
como texto, o usuario nao consegue somar valores nem filtrar por periodo -- que
e exatamente o que ele veio fazer.

Por isso a inferencia opera em duas etapas:
  1. Decidir o tipo a partir de uma AMOSTRA (barato, em Python puro).
  2. Converter a coluna inteira em Polars com a estrategia escolhida (rapido,
     vetorizado).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import polars as pl

ColumnType = Literal["text", "number", "currency", "date", "boolean", "empty"]

# Quantos valores nao nulos observar antes de decidir. Amostra grande o
# suficiente para ser representativa, pequena o suficiente para ser instantanea
# mesmo em 500 mil linhas.
SAMPLE_SIZE = 1_000

# Fracao minima da amostra que precisa casar com o padrao para adotarmos o
# tipo. Nao exigimos 100%: planilhas reais tem uma celula com "N/A" ou "-" no
# meio de uma coluna numerica, e essa unica sujeira nao deveria rebaixar a
# coluna inteira para texto.
MATCH_THRESHOLD = 0.90

# Textos que representam ausencia de valor em planilhas reais.
NULL_TOKENS = frozenset(
    {"", "-", "--", "n/a", "na", "nao informado", "não informado", "null", "nulo", "#n/d", "#n/a"}
)

TRUE_TOKENS = frozenset({"sim", "s", "true", "verdadeiro", "v", "1", "yes", "y"})
FALSE_TOKENS = frozenset({"nao", "não", "n", "false", "falso", "f", "0", "no"})

# Numero com virgula decimal: "1.234,56", "1234,5", "-12,00"
BR_DECIMAL_RE = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d+$|^-?\d+,\d+$")
# Numero com ponto decimal ou sem decimal: "1,234.56", "1234.56", "1234"
US_DECIMAL_RE = re.compile(r"^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$")

CURRENCY_SYMBOLS_RE = re.compile(r"[R$€£\s]|BRL|USD", re.IGNORECASE)
# Sinal negativo contabil: (1.234,56) significa -1234.56
ACCOUNTING_NEGATIVE_RE = re.compile(r"^\((.+)\)$")

# Formatos de data testados, do mais provavel ao menos, para o publico-alvo.
DATE_FORMATS: tuple[str, ...] = (
    "%d/%m/%Y",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%Y-%m-%d",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%d/%m/%y",
)

# Cabecalhos que sugerem coluna monetaria mesmo sem simbolo nos valores.
CURRENCY_HEADER_HINTS = (
    "valor", "preco", "preço", "total", "custo", "saldo", "montante", "receita",
    "despesa", "pagamento", "salario", "salário", "tarifa", "juros", "desconto",
    "credito", "crédito", "debito", "débito", "amount", "price", "cost", "revenue",
    "r$", "brl", "usd", "faturamento", "ticket",
)


@dataclass(frozen=True)
class ColumnStrategy:
    """Como converter uma coluna, decidido a partir da amostra."""

    column_type: ColumnType
    # Para numeros: qual separador decimal o texto usa.
    decimal_separator: Literal[",", "."] | None = None
    # Para datas: qual formato casou com a amostra.
    date_format: str | None = None


def normalize_null_token(value: str) -> str | None:
    """Converte marcadores textuais de ausencia em None."""
    stripped = value.strip()
    return None if stripped.lower() in NULL_TOKENS else stripped


def looks_like_currency(header: str, samples: list[str]) -> bool:
    """Coluna monetaria: pelo simbolo nos valores ou pela semantica do cabecalho."""
    lowered = header.strip().lower()
    if any(hint in lowered for hint in CURRENCY_HEADER_HINTS):
        return True
    return any("R$" in s or "$" in s or "€" in s for s in samples[:100])


def _clean_numeric_text(value: str) -> str:
    """Remove simbolo de moeda e converte parenteses contabeis em sinal negativo."""
    text = CURRENCY_SYMBOLS_RE.sub("", value).strip()
    accounting = ACCOUNTING_NEGATIVE_RE.match(text)
    if accounting:
        text = f"-{accounting.group(1)}"
    return text


def _match_ratio(samples: list[str], predicate) -> float:
    if not samples:
        return 0.0
    return sum(1 for s in samples if predicate(s)) / len(samples)


def _detect_number(samples: list[str]) -> ColumnStrategy | None:
    """Decide entre formato brasileiro e internacional.

    A ambiguidade e real: "1.234" pode ser mil duzentos e trinta e quatro
    (separador de milhar) ou um inteiro e duzentos e trinta e quatro milesimos.
    Resolvemos olhando a COLUNA INTEIRA: se qualquer valor usa virgula decimal,
    o ponto naquela coluna e separador de milhar. Decidir celula a celula
    produziria uma coluna com escalas misturadas -- erro grave e silencioso num
    relatorio financeiro.
    """
    cleaned = [_clean_numeric_text(s) for s in samples]
    cleaned = [c for c in cleaned if c]
    if not cleaned:
        return None

    br_ratio = _match_ratio(cleaned, lambda s: bool(BR_DECIMAL_RE.match(s)))
    us_ratio = _match_ratio(cleaned, lambda s: bool(US_DECIMAL_RE.match(s)))

    # Qualquer virgula decimal presente decide a coluna toda como BR.
    if br_ratio > 0 and (br_ratio + us_ratio) >= MATCH_THRESHOLD:
        return ColumnStrategy(column_type="number", decimal_separator=",")
    if us_ratio >= MATCH_THRESHOLD:
        return ColumnStrategy(column_type="number", decimal_separator=".")
    return None


def _detect_date(samples: list[str]) -> ColumnStrategy | None:
    """Encontra o primeiro formato que explica a amostra inteira.

    Ordem importa: "%d/%m/%Y" antes de "%m/%d/%Y" porque 03/09/2026 quase
    sempre significa 3 de setembro para este publico. Inverter a ordem
    corromperia silenciosamente todo filtro por periodo.
    """
    for fmt in DATE_FORMATS:
        def parses(value: str, fmt: str = fmt) -> bool:
            try:
                datetime.strptime(value, fmt)
                return True
            except ValueError:
                return False

        if _match_ratio(samples, parses) >= MATCH_THRESHOLD:
            return ColumnStrategy(column_type="date", date_format=fmt)
    return None


def _detect_boolean(samples: list[str]) -> bool:
    lowered = {s.lower() for s in samples}
    if not lowered or not lowered <= (TRUE_TOKENS | FALSE_TOKENS):
        return False
    # "0"/"1" sozinhos sao numeros com muito mais frequencia do que booleanos.
    return not lowered <= {"0", "1"}


def infer_strategy(header: str, series: pl.Series) -> ColumnStrategy:
    """Determina o tipo de uma coluna e como converte-la."""
    dtype = series.dtype

    # Excel ja entrega numeros e datas tipados: nao ha o que adivinhar.
    if dtype.is_numeric():
        samples = [str(v) for v in series.drop_nulls().head(100).to_list()]
        kind: ColumnType = "currency" if looks_like_currency(header, samples) else "number"
        return ColumnStrategy(column_type=kind)

    if dtype in (pl.Date, pl.Datetime):
        return ColumnStrategy(column_type="date")

    if dtype == pl.Boolean:
        return ColumnStrategy(column_type="boolean")

    # Coluna textual: e aqui que mora o trabalho de verdade.
    raw = series.drop_nulls().cast(pl.String, strict=False).head(SAMPLE_SIZE).to_list()
    samples = [cleaned for v in raw if (cleaned := normalize_null_token(str(v)))]

    if not samples:
        return ColumnStrategy(column_type="empty")

    if _detect_boolean(samples):
        return ColumnStrategy(column_type="boolean")

    numeric = _detect_number(samples)
    if numeric is not None:
        kind = "currency" if looks_like_currency(header, samples) else "number"
        return ColumnStrategy(column_type=kind, decimal_separator=numeric.decimal_separator)

    dated = _detect_date(samples)
    if dated is not None:
        return dated

    return ColumnStrategy(column_type="text")


def build_expression(column: str, dtype: pl.DataType, strategy: ColumnStrategy) -> pl.Expr:
    """Monta a EXPRESSAO Polars que converte a coluna inteira.

    Trabalhamos com expressoes, e nao com Series ja materializadas, para que o
    Polars execute todas as conversoes numa unica passada paralelizada. Em uma
    planilha de 40 colunas isso e a diferenca entre 40 varreduras e uma.

    Conversoes usam `strict=False`: uma celula suja vira null em vez de derrubar
    a ingestao da planilha inteira. O perfil vai contabiliza-la como valor
    vazio, o que e informacao util para o usuario.
    """
    source = pl.col(column)

    if strategy.column_type in ("number", "currency"):
        if dtype.is_numeric():
            return source.cast(pl.Float64, strict=False).alias(column)

        text = source.cast(pl.String, strict=False).str.strip_chars()
        # Remove simbolo de moeda e espacos internos -- inclusive o espaco nao
        # separavel (U+00A0) que o Excel insere em "R$ 1.234,56".
        text = text.str.replace_all(r"R\$|[$€£]|\s|\u00a0|BRL|USD", "")
        # Parenteses contabeis: (1.234,56) significa -1234,56
        text = text.str.replace_all(r"^\((.*)\)$", r"-$1")

        if strategy.decimal_separator == ",":
            text = text.str.replace_all(r"\.", "").str.replace_all(",", ".")
        else:
            text = text.str.replace_all(",", "")

        return text.cast(pl.Float64, strict=False).alias(column)

    if strategy.column_type == "date":
        if dtype in (pl.Date, pl.Datetime):
            return source.cast(pl.Datetime("us"), strict=False).alias(column)
        return (
            source.cast(pl.String, strict=False)
            .str.strip_chars()
            .str.to_datetime(format=strategy.date_format, strict=False, exact=True)
            .alias(column)
        )

    if strategy.column_type == "boolean":
        if dtype == pl.Boolean:
            return source.alias(column)
        lowered = source.cast(pl.String, strict=False).str.strip_chars().str.to_lowercase()
        return (
            pl.when(lowered.is_in(list(TRUE_TOKENS)))
            .then(pl.lit(True))
            .when(lowered.is_in(list(FALSE_TOKENS)))
            .then(pl.lit(False))
            .otherwise(pl.lit(None, dtype=pl.Boolean))
            .alias(column)
        )

    # Texto (e tambem colunas vazias): normaliza marcadores de ausencia
    # ("-", "N/A", "nao informado", "") para null, de modo que o filtro
    # "esta vazio" funcione independentemente da convencao usada na planilha.
    #
    # Uma coluna totalmente vazia passa por aqui de proposito. A tentacao seria
    # devolver `pl.lit(None)`, mas um literal ESCALAR dentro de um `select`
    # colapsa o DataFrame inteiro para uma unica linha -- perdendo a planilha
    # toda por causa de uma coluna sem dados.
    text = source.cast(pl.String, strict=False).str.strip_chars()
    return (
        pl.when(text.str.to_lowercase().is_in(list(NULL_TOKENS)) | (text.str.len_chars() == 0))
        .then(pl.lit(None, dtype=pl.String))
        .otherwise(text)
        .alias(column)
    )


def coerce_dataframe(frame: pl.DataFrame) -> tuple[pl.DataFrame, dict[str, ColumnType]]:
    """Infere o tipo de cada coluna e converte o frame inteiro de uma vez."""
    expressions: list[pl.Expr] = []
    types: dict[str, ColumnType] = {}
    replacements: dict[str, pl.Series] = {}

    for column in frame.columns:
        series = frame.get_column(column)

        # `Object` nao e gravavel em Parquet. Se algum caminho de leitura deixar
        # um passar, viramos texto aqui em vez de falhar la na escrita, no fim
        # de todo o processamento.
        if series.dtype == pl.Object:
            series = pl.Series(
                column, [None if v is None else str(v) for v in series.to_list()], dtype=pl.String
            )
            replacements[column] = series

        strategy = infer_strategy(column, series)
        expressions.append(build_expression(column, series.dtype, strategy))
        types[column] = strategy.column_type

    if replacements:
        frame = frame.with_columns(**replacements)

    return frame.select(expressions), types
