import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { extname } from 'node:path';
import type { Dataset, DatasetProfile, Paginated } from '@excelflow/contracts';
import { SUPPORTED_EXTENSIONS } from '@excelflow/contracts';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { ingestDataset } from '../../lib/engine-client.js';
import { ORIGINALS_DIR, removeFile, storeStream } from '../../lib/storage.js';
import { writeAuditLog } from '../auth/auth.repository.js';
import * as repo from './datasets.repository.js';

function toDataset(row: repo.DatasetRow): Dataset {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    rowCount: row.row_count,
    columnCount: row.column_count,
    duplicateRowCount: row.duplicate_row_count,
    rowsWithEmptyCount: row.rows_with_empty_count,
    sheetName: row.sheet_name,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
  };
}

/**
 * Valida a extensao e devolve a forma normalizada.
 *
 * A extensao vem do nome de arquivo informado pelo cliente, entao e apenas uma
 * TRIAGEM barata. A validacao que vale e a dos magic bytes, feita no engine
 * sobre o conteudo real do arquivo.
 */
function validateExtension(filename: string): string {
  const extension = extname(filename).toLowerCase();
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw AppError.unsupportedMedia(
      `Formato nao suportado. Envie um arquivo ${SUPPORTED_EXTENSIONS.join(', ')}.`,
    );
  }
  return extension;
}

/** Caracteres de controle e separadores de caminho, removidos do nome exibido. */
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f]|[/\\]/g;

/**
 * Sanitiza o nome do arquivo para EXIBICAO.
 *
 * Este nome nunca compoe caminho em disco -- o caminho real deriva de um UUID.
 * A limpeza aqui evita que um nome hostil vire problema ao ser renderizado na
 * interface ou gravado no log.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(UNSAFE_FILENAME_CHARS, '_').trim().slice(0, 400) || 'planilha';
}

export interface UploadContext {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export async function uploadDataset(
  file: { filename: string; stream: Readable },
  context: UploadContext,
): Promise<DatasetProfile> {
  const extension = validateExtension(file.filename);
  const displayName = sanitizeFilename(file.filename);

  // O nome em disco deriva de um UUID, nunca do nome enviado. Isso elimina de
  // uma vez path traversal, colisao entre usuarios e caracteres problematicos.
  const storageId = randomUUID();
  const relativePath = `${ORIGINALS_DIR}/${storageId}${extension}`;

  const stored = await storeStream(file.stream, relativePath);

  const expiresAt = new Date(Date.now() + env.DATASET_TTL_HOURS * 60 * 60 * 1000);
  const dataset = await repo.insertDataset({
    userId: context.userId,
    originalFilename: displayName,
    extension,
    sizeBytes: stored.sizeBytes,
    contentHash: stored.contentHash,
    originalPath: relativePath,
    expiresAt,
  });

  try {
    const result = await ingestDataset({
      datasetId: dataset.id,
      originalPath: relativePath,
      extension,
    });

    await repo.saveIngestionResult({
      datasetId: dataset.id,
      parquetPath: result.parquetPath,
      sheetName: result.sheetName,
      rowCount: result.rowCount,
      columnCount: result.columnCount,
      duplicateRowCount: result.duplicateRowCount,
      rowsWithEmptyCount: result.rowsWithEmptyCount,
      columns: result.columns,
    });

    await writeAuditLog({
      userId: context.userId,
      action: 'dataset.upload',
      entityType: 'dataset',
      entityId: dataset.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        // Registramos forma e desempenho, nunca conteudo da planilha.
        rows: result.rowCount,
        columns: result.columnCount,
        sizeBytes: stored.sizeBytes,
        durationMs: result.durationMs,
      },
    });

    return {
      dataset: toDataset({
        ...dataset,
        parquet_path: result.parquetPath,
        sheet_name: result.sheetName,
        row_count: result.rowCount,
        column_count: result.columnCount,
        duplicate_row_count: result.duplicateRowCount,
        rows_with_empty_count: result.rowsWithEmptyCount,
        status: 'ready',
      }),
      columns: result.columns,
    };
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Falha ao processar a planilha.';
    await repo.markDatasetFailed(dataset.id, message);
    // O original so serve para ser processado. Se a ingestao falhou, guarda-lo
    // seria manter dado interno da empresa no servidor sem proposito nenhum.
    await removeFile(relativePath);
    throw error;
  }
}

export async function getDatasetProfile(
  datasetId: string,
  userId: string,
): Promise<DatasetProfile> {
  const row = await repo.findDatasetById(datasetId, userId);
  if (!row) {
    throw AppError.notFound('Planilha nao encontrada.');
  }

  return {
    dataset: toDataset(row),
    columns: await repo.findDatasetColumns(datasetId),
  };
}

export async function listDatasets(
  userId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<Dataset>> {
  const { items, total } = await repo.listDatasets(userId, page, pageSize);
  return {
    items: items.map(toDataset),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function deleteDataset(
  datasetId: string,
  userId: string,
  context: Omit<UploadContext, 'userId'>,
): Promise<void> {
  const row = await repo.findDatasetById(datasetId, userId);
  if (!row) {
    throw AppError.notFound('Planilha nao encontrada.');
  }

  const deleted = await repo.deleteDataset(datasetId, userId);
  if (!deleted) {
    throw AppError.notFound('Planilha nao encontrada.');
  }

  // Os arquivos so sao removidos DEPOIS que a linha some do banco. Na ordem
  // inversa, uma falha no DELETE deixaria um dataset "pronto" no historico
  // apontando para arquivos que ja nao existem.
  await removeFile(row.original_path);
  await removeFile(row.parquet_path);

  await writeAuditLog({
    userId,
    action: 'dataset.delete',
    entityType: 'dataset',
    entityId: datasetId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}
