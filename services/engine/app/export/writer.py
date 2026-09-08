"""Exportacao do resultado para Excel e CSV."""

from __future__ import annotations

import csv
import logging
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

import xlsxwriter

from app.engine.executor import connect, iter_result_batches
from app.engine.schema import DatasetSchema

logger = logging.getLogger(__name__)

# Limite fisico de linhas de uma planilha .xlsx (2^20). Nao e escolha nossa.
EXCEL_MAX_ROWS = 1_048_576

# Caracteres que o Excel interpreta como inicio de FORMULA.
#
# Este e o vetor de "CSV injection": uma celula com
# `=cmd|'/c calc'!A1` executa comando na maquina de quem abrir o arquivo. Como
# o conteudo vem da planilha que o usuario enviou -- e ele pode ter recebido de
# terceiros --, o dado nao e confiavel. Prefixamos com apostrofo, que o Excel
# entende como "isto e texto".
FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def neutralize_formula(value: str) -> str:
    """Impede que um valor exportado seja executado como formula."""
    if value and value[0] in FORMULA_TRIGGERS:
        return "'" + value
    return value


def _cell(value: Any) -> Any:
    """Prepara um valor para a celula, sem perder tipo."""
    if value is None:
        return None
    if isinstance(value, str):
        return neutralize_formula(value)
    if isinstance(value, Decimal):
        return float(value)
    return value


def write_xlsx(
    destination: Path,
    columns: list[str],
    batches: Iterable[list[tuple]],
    summary: list[dict[str, Any]] | None,
    total_rows: int,
    source_name: str,
) -> int:
    """Escreve o resultado em .xlsx com abas "Resultado" e "Resumo".

    `constant_memory=True` faz o XlsxWriter descarregar cada linha para disco em
    vez de acumular a planilha inteira na RAM. E o que permite exportar
    centenas de milhares de linhas com consumo constante. O preco e que as
    linhas devem ser escritas em ordem, o que respeitamos.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)

    workbook = xlsxwriter.Workbook(
        str(destination), {"constant_memory": True, "default_date_format": "dd/mm/yyyy"}
    )
    try:
        header_format = workbook.add_format(
            {"bold": True, "bg_color": "#EEF0F3", "border": 1, "border_color": "#CBD0D8"}
        )
        date_format = workbook.add_format({"num_format": "dd/mm/yyyy"})
        money_format = workbook.add_format({"num_format": 'R$ #,##0.00'})

        sheet = workbook.add_worksheet("Resultado")
        sheet.freeze_panes(1, 0)  # cabecalho fixo ao rolar

        for index, name in enumerate(columns):
            sheet.write(0, index, name, header_format)
            # Largura aproximada pelo tamanho do cabecalho: sem isso as colunas
            # saem estreitas e o usuario precisa ajustar todas a mao.
            sheet.set_column(index, index, min(max(len(name) + 4, 12), 40))

        written = 0
        truncated = False

        for batch in batches:
            for record in batch:
                if written + 1 >= EXCEL_MAX_ROWS:
                    truncated = True
                    break
                row = written + 1
                for index, value in enumerate(record):
                    prepared = _cell(value)
                    if isinstance(prepared, (datetime, date)):
                        sheet.write_datetime(row, index, prepared, date_format)
                    elif prepared is None:
                        sheet.write_blank(row, index, None)
                    else:
                        sheet.write(row, index, prepared)
                written += 1
            if truncated:
                break

        if summary is not None:
            _write_summary(workbook, summary, written, total_rows, source_name,
                           header_format, money_format, truncated)

        return written
    finally:
        workbook.close()


def _write_summary(
    workbook,
    summary: list[dict[str, Any]],
    written: int,
    total_rows: int,
    source_name: str,
    header_format,
    money_format,
    truncated: bool,
) -> None:
    """Aba "Resumo": o que foi feito e quanto deu.

    Sem ela o arquivo exportado e apenas linhas soltas. Com ela, quem receber a
    planilha entende de onde ela veio, quantos registros tinha e quais foram os
    totais -- sem precisar perguntar.
    """
    sheet = workbook.add_worksheet("Resumo")
    sheet.set_column(0, 0, 38)
    sheet.set_column(1, 1, 26)

    title = workbook.add_format({"bold": True, "font_size": 12})
    label = workbook.add_format({"bold": True})

    sheet.write(0, 0, "Resumo do processamento", title)
    sheet.write(2, 0, "Planilha de origem", label)
    sheet.write(2, 1, neutralize_formula(source_name))
    sheet.write(3, 0, "Gerado em", label)
    sheet.write(3, 1, datetime.now().strftime("%d/%m/%Y %H:%M"))
    sheet.write(4, 0, "Registros exportados", label)
    sheet.write(4, 1, written)

    row = 6
    if truncated:
        sheet.write(
            row, 0,
            f"Atencao: o resultado tinha {total_rows} linhas e foi cortado no "
            f"limite do Excel ({EXCEL_MAX_ROWS - 1}). Exporte em CSV para levar tudo.",
            label,
        )
        row += 2

    if summary:
        sheet.write(row, 0, "Analises", header_format)
        sheet.write(row, 1, "Resultado", header_format)
        row += 1
        for metric in summary:
            sheet.write(row, 0, neutralize_formula(str(metric.get("label", ""))))
            value = metric.get("value")
            if value is None:
                sheet.write(row, 1, "--")
            elif metric.get("format") == "currency":
                sheet.write_number(row, 1, float(value), money_format)
            else:
                sheet.write_number(row, 1, float(value))
            row += 1


def write_csv(
    destination: Path,
    columns: list[str],
    batches: Iterable[list[tuple]],
) -> int:
    """Escreve o resultado em CSV no padrao brasileiro.

    Separador ';' e virgula decimal: e o que o Excel em portugues abre sem pedir
    assistente de importacao. Um CSV "correto" com virgula e ponto decimal
    apareceria todo numa coluna so.

    Encoding UTF-8 com BOM pelo mesmo motivo -- sem o BOM, o Excel no Windows le
    o arquivo como ANSI e os acentos saem quebrados.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    written = 0

    with destination.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        writer.writerow([neutralize_formula(name) for name in columns])

        for batch in batches:
            for record in batch:
                writer.writerow([_csv_value(value) for value in record])
                written += 1

    return written


def _csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, Decimal):
        return f"{value:.2f}".replace(".", ",")
    if isinstance(value, float):
        return f"{value:.2f}".replace(".", ",")
    if isinstance(value, bool):
        return "Sim" if value else "Nao"
    return neutralize_formula(str(value))


def export_result(
    destination: Path,
    parquet_path: Path,
    schema: DatasetSchema,
    recipe: dict,
    fmt: str,
    columns: list[str] | None,
    summary: list[dict[str, Any]] | None,
    source_name: str,
) -> tuple[int, list[str]]:
    """Executa a receita e grava o resultado no formato pedido."""
    from app.engine.executor import prepare_for_export

    compiled = prepare_for_export(parquet_path, schema, recipe, columns)

    with connect() as connection:
        stream = iter_result_batches(connection, compiled)
        names, _ = next(stream)
        batches = (batch for _, batch in stream if batch is not None)

        if fmt == "csv":
            written = write_csv(destination, names, batches)
        else:
            written = write_xlsx(
                destination, names, batches, summary, total_rows=0, source_name=source_name
            )

    return written, names
