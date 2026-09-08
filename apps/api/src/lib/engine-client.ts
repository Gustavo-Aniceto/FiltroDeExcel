import type { ColumnProfile } from '@excelflow/contracts';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

/**
 * Cliente do motor de processamento (Python).
 *
 * O engine e um servico interno, sem autenticacao de usuario: ele confia em
 * quem apresenta o segredo compartilhado. Toda chamada passa por aqui, o que
 * concentra o tratamento de timeout e de erro num unico lugar.
 */

export interface IngestResult {
  datasetId: string;
  parquetPath: string;
  sheetName: string | null;
  rowCount: number;
  columnCount: number;
  duplicateRowCount: number;
  rowsWithEmptyCount: number;
  columns: ColumnProfile[];
  durationMs: number;
}

/**
 * Timeout generoso: converter uma planilha de 100 MB e trabalho de CPU que
 * legitimamente leva dezenas de segundos. Curto demais transformaria um
 * processamento valido em erro.
 */
const INGEST_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 30_000;

async function callEngine<T>(
  path: string,
  body: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${env.ENGINE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Engine-Secret': env.ENGINE_SHARED_SECRET,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw AppError.engine(
        'O processamento demorou mais do que o limite permitido. Tente uma planilha menor.',
      );
    }
    throw AppError.engine('O motor de processamento esta indisponivel no momento.');
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    return (await response.json()) as T;
  }

  const detail = await response
    .json()
    .then((body) => (body as { detail?: string }).detail)
    .catch(() => undefined);

  // 422 significa "o ARQUIVO tem problema", e a mensagem do engine e
  // acionavel pelo usuario ("o arquivo nao e um .xlsx valido"). Os demais
  // codigos indicam problema nosso e nao devem expor detalhe interno.
  if (response.status === 422 && detail) {
    throw AppError.validation(detail);
  }

  // 410 significa que os arquivos ja foram removidos pelo TTL. Nao e falha do
  // sistema nem culpa do pedido: o dado expirou, e o usuario precisa saber
  // disso e nao "erro interno".
  if (response.status === 410) {
    throw new AppError(
      'NOT_FOUND',
      detail ?? 'Os dados desta planilha nao estao mais disponiveis.',
      410,
    );
  }

  throw AppError.engine('Nao foi possivel processar a planilha.');
}

export function ingestDataset(input: {
  datasetId: string;
  originalPath: string;
  extension: string;
}): Promise<IngestResult> {
  return callEngine<IngestResult>(
    '/internal/ingest',
    {
      dataset_id: input.datasetId,
      original_path: input.originalPath,
      extension: input.extension,
    },
    INGEST_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Execucao de Receitas
// ---------------------------------------------------------------------------

export interface EngineColumnRef {
  name: string;
  type: string;
}

export interface MetricResultRaw {
  id: string;
  label: string;
  operation: string;
  column: string | null;
  value: number | null;
  format: string | null;
  error: string | null;
}

export interface PreviewResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  inputRows: number;
  metrics: MetricResultRaw[];
  durationMs: number;
}

interface BaseQueryPayload {
  parquetPath: string;
  columns: EngineColumnRef[];
  recipe: unknown;
}

function basePayload(input: BaseQueryPayload) {
  return {
    parquet_path: input.parquetPath,
    columns: input.columns,
    recipe: input.recipe,
  };
}

export function enginePreview(
  input: BaseQueryPayload & {
    page: number;
    pageSize: number;
    search?: string | null;
    metrics?: unknown[];
  },
): Promise<PreviewResult> {
  return callEngine<PreviewResult>('/internal/preview', {
    ...basePayload(input),
    page: input.page,
    page_size: input.pageSize,
    search: input.search ?? null,
    metrics: input.metrics ?? [],
  });
}

export function engineColumnValues(
  input: BaseQueryPayload & { column: string; search?: string | null; limit?: number },
): Promise<{ values: Array<{ value: string; count: number }> }> {
  return callEngine('/internal/column-values', {
    ...basePayload(input),
    column: input.column,
    search: input.search ?? null,
    limit: input.limit ?? 50,
  });
}

export function engineSuggestedMetrics(
  input: BaseQueryPayload,
): Promise<{ metrics: unknown[] }> {
  return callEngine('/internal/suggested-metrics', basePayload(input));
}

export interface ExportResult {
  path: string;
  rowCount: number;
  sizeBytes: number;
  columns: string[];
  durationMs: number;
}

/**
 * Exportar percorre o resultado inteiro e escreve o arquivo -- muito mais caro
 * do que uma previa paginada. Por isso reaproveita o timeout longo da ingestao.
 */
export function engineExport(
  input: BaseQueryPayload & {
    format: 'xlsx' | 'csv';
    exportColumns?: string[] | null;
    summary?: unknown[] | null;
    sourceName: string;
  },
): Promise<ExportResult> {
  return callEngine<ExportResult>(
    '/internal/export',
    {
      ...basePayload(input),
      fmt: input.format,
      export_columns: input.exportColumns ?? null,
      summary: input.summary ?? null,
      source_name: input.sourceName,
    },
    INGEST_TIMEOUT_MS,
  );
}
