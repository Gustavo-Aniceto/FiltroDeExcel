"""Esquema de um dataset: a whitelist que torna a compilacao de SQL segura."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ColumnType = Literal["text", "number", "currency", "date", "boolean", "empty"]

NUMERIC_TYPES: frozenset[str] = frozenset({"number", "currency"})


class SchemaError(ValueError):
    """Coluna inexistente ou uso incompativel com o tipo dela."""


@dataclass(frozen=True)
class Column:
    name: str
    type: ColumnType

    @property
    def is_numeric(self) -> bool:
        return self.type in NUMERIC_TYPES

    @property
    def is_date(self) -> bool:
        return self.type == "date"


class DatasetSchema:
    """Colunas conhecidas de um dataset.

    Esta classe e a UNICA fonte de identificadores SQL do sistema. Nenhum nome
    de coluna chega ao SQL sem passar por `resolve()`, que confere se ele existe
    no dataset. Um nome inventado -- por um cliente adulterado ou pela IA da
    Fase 10 -- e recusado aqui, antes de qualquer geracao de consulta.

    E por isso que a compilacao pode montar SQL com seguranca: identificadores
    saem de uma lista fechada, e valores sao sempre parametros vinculados.
    """

    def __init__(self, columns: list[Column]) -> None:
        self._columns = {column.name: column for column in columns}
        self._order = [column.name for column in columns]

    @classmethod
    def from_pairs(cls, pairs: list[tuple[str, str]]) -> DatasetSchema:
        return cls([Column(name=name, type=type_) for name, type_ in pairs])  # type: ignore[arg-type]

    @property
    def names(self) -> list[str]:
        return list(self._order)

    def __contains__(self, name: str) -> bool:
        return name in self._columns

    def resolve(self, name: str) -> Column:
        column = self._columns.get(name)
        if column is None:
            # A mensagem precisa ser acionavel: acontece de verdade quando o
            # usuario reaplica uma receita salva numa planilha cujo cabecalho
            # mudou. Dizer QUAL coluna falta resolve o problema dele.
            raise SchemaError(f'A coluna "{name}" nao existe nesta planilha.')
        return column

    def require_numeric(self, name: str, operation: str) -> Column:
        column = self.resolve(name)
        if not column.is_numeric:
            raise SchemaError(
                f'Nao e possivel calcular {operation} da coluna "{name}": '
                "ela nao contem valores numericos."
            )
        return column

    def subset(self, names: list[str]) -> DatasetSchema:
        return DatasetSchema([self.resolve(name) for name in names])

    def renamed(self, mapping: dict[str, str]) -> DatasetSchema:
        return DatasetSchema(
            [
                Column(name=mapping.get(column.name, column.name), type=column.type)
                for column in (self._columns[name] for name in self._order)
            ]
        )

    def without(self, names: set[str]) -> DatasetSchema:
        return DatasetSchema([self._columns[n] for n in self._order if n not in names])

    def with_type(self, name: str, type_: ColumnType) -> DatasetSchema:
        return DatasetSchema(
            [
                Column(name=n, type=type_ if n == name else self._columns[n].type)
                for n in self._order
            ]
        )


def quote_ident(name: str) -> str:
    """Escapa um identificador SQL.

    Nomes vem do cabecalho da planilha e contem acentos, espacos e parenteses.
    Aspas duplas com duplicacao interna e o escape correto -- e o nome so chega
    aqui depois de validado contra o esquema.
    """
    return '"' + name.replace('"', '""') + '"'
