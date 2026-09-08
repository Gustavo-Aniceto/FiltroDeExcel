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
