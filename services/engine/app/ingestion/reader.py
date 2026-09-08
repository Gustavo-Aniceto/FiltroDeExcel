"""Leitura de planilhas para um DataFrame Polars normalizado.

Todo arquivo que chega aqui e NAO CONFIAVEL. As validacoes deste modulo -- e o
isolamento do engine em processo separado -- sao a linha de defesa contra
arquivo malicioso disfarcado de planilha.
"""

from __future__ import annotations

import csv as csv_module
import logging
import zipfile
from dataclasses import dataclass
from pathlib import Path

import polars as pl

logger = logging.getLogger(__name__)

# Assinaturas dos formatos aceitos. A extensao do arquivo e sugestao do
# cliente; os bytes iniciais sao evidencia.
XLSX_MAGIC = b"PK\x03\x04"          # .xlsx e um container ZIP
XLS_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # .xls e um documento OLE2

# Um .xlsx e ZIP: um arquivo de 1 MB pode expandir para gigabytes e esgotar a
# memoria do servidor (zip bomb). Recusamos razoes de compressao absurdas antes
# de qualquer parsing.
MAX_DECOMPRESSION_RATIO = 150
MAX_DECOMPRESSED_BYTES = 2_000_000_000  # 2 GB

# Tetos de forma. Protegem contra planilha com 20 mil colunas, que geraria SQL
# gigantesco e um perfil inutil.
MAX_COLUMNS = 512
MAX_ROWS = 2_000_000

CSV_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


class IngestionError(Exception):
    """Falha atribuivel ao arquivo enviado, segura para mostrar ao usuario."""


@dataclass(frozen=True)
class ReadResult:
    frame: pl.DataFrame
    sheet_name: str | None


def validate_magic_bytes(path: Path, extension: str) -> None:
    """Confere se o conteudo corresponde a extensao declarada."""
    with path.open("rb") as handle:
        head = handle.read(8)

    if extension == ".xlsx":
        if not head.startswith(XLSX_MAGIC):
            raise IngestionError(
                "O arquivo nao e um .xlsx valido. Se ele foi renomeado a partir de outro "
                "formato, salve-o novamente pelo Excel como .xlsx."
            )
    elif extension == ".xls":
        # Alguns sistemas exportam .xlsx com extensao .xls; aceitamos os dois.
        if not (head.startswith(XLS_MAGIC) or head.startswith(XLSX_MAGIC)):
            raise IngestionError("O arquivo nao e uma planilha Excel valida.")
    elif extension == ".csv":
        # CSV nao tem assinatura. Byte nulo no inicio denuncia arquivo binario
        # renomeado -- o unico teste barato e confiavel aqui.
        if b"\x00" in head:
            raise IngestionError("O arquivo parece ser binario, nao um CSV de texto.")
    else:
        raise IngestionError(f"Extensao nao suportada: {extension}")


def guard_zip_bomb(path: Path) -> None:
    """Recusa arquivos ZIP com expansao desproporcional."""
    try:
        with zipfile.ZipFile(path) as archive:
            compressed = sum(info.compress_size for info in archive.infolist())
            uncompressed = sum(info.file_size for info in archive.infolist())
    except zipfile.BadZipFile as error:
        raise IngestionError("O arquivo .xlsx esta corrompido ou incompleto.") from error

    if uncompressed > MAX_DECOMPRESSED_BYTES:
        raise IngestionError("A planilha e grande demais para ser processada.")

    if compressed > 0 and uncompressed / compressed > MAX_DECOMPRESSION_RATIO:
        logger.warning(
            "Razao de descompressao suspeita: %.0fx", uncompressed / max(compressed, 1)
        )
        raise IngestionError("O arquivo foi recusado por apresentar compressao suspeita.")


def normalize_headers(columns: list[str]) -> list[str]:
    """Garante nomes de coluna nao vazios e unicos.

    Planilhas reais trazem cabecalho em branco e nomes repetidos ("Valor" duas
    vezes). Nomes duplicados quebrariam a referencia por nome em toda a
    aplicacao -- do filtro ao SQL gerado --, entao desambiguamos aqui, uma vez,
    e o resto do sistema pode assumir unicidade.
    """
    seen: dict[str, int] = {}
    result: list[str] = []

    for index, raw in enumerate(columns):
        name = str(raw).strip() if raw is not None else ""
        if not name or name.lower().startswith("__unnamed"):
            name = f"Coluna {index + 1}"

        if name in seen:
            seen[name] += 1
            name = f"{name} ({seen[name]})"
        else:
            seen[name] = 1

        result.append(name)

    return result


def _sniff_csv_dialect(path: Path) -> tuple[str, str]:
    """Descobre encoding e separador de um CSV.

    O separador importa muito para este publico: CSV brasileiro usa ';' porque
    a virgula ja e o separador decimal. Ler "1.234,56;APROVADO" com virgula
    como delimitador produziria colunas sem sentido.
    """
    sample = b""
    for encoding in CSV_ENCODINGS:
        try:
            with path.open("rb") as handle:
                sample = handle.read(64_000)
            text = sample.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise IngestionError("Nao foi possivel identificar a codificacao do CSV.")

    encoding_used = encoding
    first_lines = "\n".join(text.splitlines()[:20])

    try:
        dialect = csv_module.Sniffer().sniff(first_lines, delimiters=";,\t|")
        separator = dialect.delimiter
    except csv_module.Error:
        # Sniffer falha em arquivos de coluna unica. Decidimos pela contagem.
        counts = {sep: first_lines.count(sep) for sep in (";", ",", "\t", "|")}
        separator = max(counts, key=lambda k: counts[k]) if any(counts.values()) else ","

    return encoding_used, separator


def _transcode_to_utf8(path: Path, encoding: str) -> Path:
    """Reescreve o arquivo em UTF-8 num temporario, em blocos.

    O Polars le apenas UTF-8. Sistemas legados brasileiros exportam CSV em
    cp1252/latin-1, e ler esses bytes como UTF-8 corrompe todo acento --
    "Situacao" viraria "Situa\ufffd\ufffdo" e a coluna ficaria inutilizavel no
    filtro. Convertemos em blocos para nao carregar o arquivo inteiro na
    memoria.
    """
    import tempfile

    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", suffix=".csv", delete=False, newline=""
    )
    try:
        with path.open("r", encoding=encoding, errors="replace", newline="") as source:
            while chunk := source.read(1_000_000):
                handle.write(chunk)
    finally:
        handle.close()

    return Path(handle.name)


def read_csv(path: Path) -> ReadResult:
    encoding, separator = _sniff_csv_dialect(path)
    logger.info("CSV detectado: encoding=%s separador=%r", encoding, separator)

    temporary: Path | None = None
    if not encoding.startswith("utf-8"):
        temporary = _transcode_to_utf8(path, encoding)
        path = temporary

    try:
        frame = pl.read_csv(
            path,
            separator=separator,
            encoding="utf8",
            # Lemos TUDO como texto e deixamos a inferencia decidir. A inferencia
            # do Polars nao conhece formato brasileiro e transformaria "1.234,56"
            # em texto sem nos avisar; a nossa converte corretamente.
            infer_schema_length=0,
            truncate_ragged_lines=True,
            n_rows=MAX_ROWS,
        )
    except Exception as error:  # noqa: BLE001 - qualquer falha aqui e culpa do arquivo
        raise IngestionError(f"Nao foi possivel ler o CSV: {error}") from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

    return ReadResult(frame=frame, sheet_name=None)


def read_excel(path: Path) -> ReadResult:
    """Le a primeira aba com dados usando calamine.

    calamine e escrito em Rust, le .xlsx e tambem o .xls legado, e e ordens de
    grandeza mais rapido que openpyxl -- diferenca decisiva numa planilha de
    100 mil linhas.
    """
    from python_calamine import CalamineWorkbook

    try:
        workbook = CalamineWorkbook.from_path(str(path))
        sheet_names = workbook.sheet_names
    except Exception as error:  # noqa: BLE001
        raise IngestionError(f"Nao foi possivel abrir a planilha: {error}") from error

    if not sheet_names:
        raise IngestionError("A planilha nao contem nenhuma aba.")

    # Abas vazias no inicio sao comuns (capa, instrucoes). Pegamos a primeira
    # que realmente tem dados, em vez de devolver um resultado vazio.
    for sheet_name in sheet_names:
        try:
            rows = workbook.get_sheet_by_name(sheet_name).to_python(skip_empty_area=True)
        except Exception:  # noqa: BLE001, PERF203
            continue
        if rows and len(rows) > 1:
            break
    else:
        raise IngestionError("Nenhuma aba da planilha contem dados.")

    header, *data = rows
    if len(header) > MAX_COLUMNS:
        raise IngestionError(f"A planilha excede o limite de {MAX_COLUMNS} colunas.")

    columns = normalize_headers([str(cell) if cell is not None else "" for cell in header])
    width = len(columns)

    # Linhas mais curtas que o cabecalho sao normais em planilhas editadas a
    # mao; completamos com vazio em vez de recusar o arquivo.
    normalized_rows = [
        list(row[:width]) + [None] * (width - len(row)) for row in data[:MAX_ROWS]
    ]

    # Montamos COLUNA A COLUNA, e nao linha a linha.
    #
    # Uma celula de Excel pode conter numero, texto ou data, e o calamine as
    # devolve como objetos Python de tipos distintos. Construir o DataFrame por
    # linhas faz o Polars cair no dtype `Object` numa coluna heterogenea -- e
    # `Object` nao pode ser gravado em Parquet, o que quebraria a ingestao la no
    # fim do processo. Coluna a coluna conseguimos detectar a heterogeneidade e
    # cair para texto, deixando a nossa inferencia decidir o tipo depois.
    series = [
        _build_series(name, [row[index] for row in normalized_rows])
        for index, name in enumerate(columns)
    ]
    return ReadResult(frame=pl.DataFrame(series), sheet_name=sheet_name)


def _build_series(name: str, values: list) -> pl.Series:
    """Cria uma Series tolerante a celulas de tipos misturados."""
    try:
        series = pl.Series(name, values, strict=False)
    except Exception:  # noqa: BLE001 - qualquer falha cai para texto
        series = None

    if series is None or series.dtype == pl.Object:
        return pl.Series(name, [None if v is None else str(v) for v in values], dtype=pl.String)

    return series


def read_any(path: Path, extension: str) -> ReadResult:
    """Ponto de entrada: valida e le o arquivo conforme a extensao."""
    validate_magic_bytes(path, extension)

    if extension in (".xlsx", ".xls"):
        with path.open("rb") as handle:
            if handle.read(4).startswith(XLSX_MAGIC):
                guard_zip_bomb(path)
        result = read_excel(path)
    elif extension == ".csv":
        result = read_csv(path)
    else:
        raise IngestionError(f"Extensao nao suportada: {extension}")

    frame = result.frame
    if frame.width == 0:
        raise IngestionError("A planilha nao contem colunas.")
    if frame.width > MAX_COLUMNS:
        raise IngestionError(f"A planilha excede o limite de {MAX_COLUMNS} colunas.")

    frame = frame.rename(dict(zip(frame.columns, normalize_headers(frame.columns))))
    return ReadResult(frame=frame, sheet_name=result.sheet_name)
