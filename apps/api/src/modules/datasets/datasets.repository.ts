import type { ColumnProfile, ColumnType, DatasetStatus } from '@excelflow/contracts';
import { createRequest, getPool, sql } from '../../db/pool.js';

export interface DatasetRow {
  id: string;
  user_id: string;
  original_filename: string;
  extension: string;
  size_bytes: number;
  original_path: string | null;
  parquet_path: string | null;
  sheet_name: string | null;
  row_count: number;
  column_count: number;
  duplicate_row_count: number;
  rows_with_empty_count: number;
  status: DatasetStatus;
  error_message: string | null;
  created_at: Date;
  expires_at: Date | null;
}

export async function insertDataset(input: {
  userId: string;
  originalFilename: string;
  extension: string;
  sizeBytes: number;
  contentHash: Buffer;
  originalPath: string;
  expiresAt: Date;
}): Promise<DatasetRow> {
  const request = await createRequest();
  const result = await request
    .input('userId', sql.UniqueIdentifier, input.userId)
    .input('originalFilename', sql.NVarChar(400), input.originalFilename)
    .input('extension', sql.VarChar(10), input.extension)
    .input('sizeBytes', sql.BigInt, input.sizeBytes)
    .input('contentHash', sql.Binary, input.contentHash)
    .input('originalPath', sql.NVarChar(500), input.originalPath)
    .input('expiresAt', sql.DateTime2(3), input.expiresAt)
    .query<DatasetRow>(
      `INSERT INTO dbo.datasets
         (user_id, original_filename, extension, size_bytes, content_hash,
          original_path, expires_at, status)
       OUTPUT inserted.*
       VALUES (@userId, @originalFilename, @extension, @sizeBytes, @contentHash,
               @originalPath, @expiresAt, 'processing')`,
    );
  const row = result.recordset[0];
  if (!row) throw new Error('Falha ao registrar o dataset');
  return row;
}

/**
 * Grava o resultado da ingestao numa unica transacao.
 *
 * O perfil das colunas e o status "ready" precisam ficar visiveis juntos: um
 * dataset marcado como pronto sem colunas registradas quebraria toda a
 * validacao de coluna das fases seguintes, que usa esta tabela como whitelist.
 */
export async function saveIngestionResult(input: {
  datasetId: string;
  parquetPath: string;
  sheetName: string | null;
  rowCount: number;
  columnCount: number;
  duplicateRowCount: number;
  rowsWithEmptyCount: number;
  columns: ColumnProfile[];
}): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, input.datasetId)
      .input('parquetPath', sql.NVarChar(500), input.parquetPath)
      .input('sheetName', sql.NVarChar(200), input.sheetName)
      .input('rowCount', sql.Int, input.rowCount)
      .input('columnCount', sql.Int, input.columnCount)
      .input('duplicateRowCount', sql.Int, input.duplicateRowCount)
      .input('rowsWithEmptyCount', sql.Int, input.rowsWithEmptyCount)
      .query(
        `UPDATE dbo.datasets
            SET parquet_path = @parquetPath,
                sheet_name = @sheetName,
                row_count = @rowCount,
                column_count = @columnCount,
                duplicate_row_count = @duplicateRowCount,
                rows_with_empty_count = @rowsWithEmptyCount,
                status = 'ready',
                error_message = NULL,
                processed_at = SYSUTCDATETIME()
          WHERE id = @id`,
      );

    for (const column of input.columns) {
      await new sql.Request(transaction)
        .input('datasetId', sql.UniqueIdentifier, input.datasetId)
        .input('name', sql.NVarChar(255), column.name)
        .input('position', sql.Int, column.position)
        .input('inferredType', sql.VarChar(20), column.type)
        .input('nullCount', sql.Int, column.nullCount)
        .input('distinctCount', sql.Int, column.distinctCount)
        .input('minValue', sql.Decimal(38, 10), column.min ?? null)
        .input('maxValue', sql.Decimal(38, 10), column.max ?? null)
        .input('sumValue', sql.Decimal(38, 10), column.sum ?? null)
        .input('avgValue', sql.Decimal(38, 10), column.avg ?? null)
        .input('minDate', sql.DateTime2(3), column.minDate ? new Date(column.minDate) : null)
        .input('maxDate', sql.DateTime2(3), column.maxDate ? new Date(column.maxDate) : null)
        .input(
          'topValues',
          sql.NVarChar(sql.MAX),
          column.topValues ? JSON.stringify(column.topValues) : null,
        )
        .query(
          `INSERT INTO dbo.dataset_columns
             (dataset_id, name, position, inferred_type, null_count, distinct_count,
              min_value, max_value, sum_value, avg_value, min_date, max_date, top_values)
           VALUES (@datasetId, @name, @position, @inferredType, @nullCount, @distinctCount,
                   @minValue, @maxValue, @sumValue, @avgValue, @minDate, @maxDate, @topValues)`,
        );
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function markDatasetFailed(datasetId: string, message: string): Promise<void> {
  const request = await createRequest();
  await request
    .input('id', sql.UniqueIdentifier, datasetId)
    .input('message', sql.NVarChar(2000), message.slice(0, 2000))
    .query(
      `UPDATE dbo.datasets
          SET status = 'failed', error_message = @message, processed_at = SYSUTCDATETIME()
        WHERE id = @id`,
    );
}

/** Sempre filtra por user_id: um ID adivinhado nao da acesso a nada (IDOR). */
export async function findDatasetById(
  datasetId: string,
  userId: string,
): Promise<DatasetRow | null> {
  const request = await createRequest();
  const result = await request
    .input('id', sql.UniqueIdentifier, datasetId)
    .input('userId', sql.UniqueIdentifier, userId)
    .query<DatasetRow>('SELECT * FROM dbo.datasets WHERE id = @id AND user_id = @userId');
  return result.recordset[0] ?? null;
}

interface ColumnRow {
  name: string;
  position: number;
  inferred_type: ColumnType;
  null_count: number;
  distinct_count: number;
  min_value: number | null;
  max_value: number | null;
  sum_value: number | null;
  avg_value: number | null;
  min_date: Date | null;
  max_date: Date | null;
  top_values: string | null;
}

export async function findDatasetColumns(datasetId: string): Promise<ColumnProfile[]> {
  const request = await createRequest();
  const result = await request
    .input('datasetId', sql.UniqueIdentifier, datasetId)
    .query<ColumnRow>(
      `SELECT name, position, inferred_type, null_count, distinct_count,
              min_value, max_value, sum_value, avg_value, min_date, max_date, top_values
         FROM dbo.dataset_columns
        WHERE dataset_id = @datasetId
        ORDER BY position`,
    );

  return result.recordset.map((row) => ({
    name: row.name,
    position: row.position,
    type: row.inferred_type,
    nullCount: row.null_count,
    distinctCount: row.distinct_count,
    // DECIMAL volta como string no driver TDS quando a precisao e alta;
    // Number() normaliza sem perder os centavos.
    min: row.min_value === null ? null : Number(row.min_value),
    max: row.max_value === null ? null : Number(row.max_value),
    sum: row.sum_value === null ? null : Number(row.sum_value),
    avg: row.avg_value === null ? null : Number(row.avg_value),
    minDate: row.min_date?.toISOString() ?? null,
    maxDate: row.max_date?.toISOString() ?? null,
    topValues: row.top_values ? JSON.parse(row.top_values) : undefined,
  }));
}

export async function listDatasets(
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ items: DatasetRow[]; total: number }> {
  const request = await createRequest();
  const result = await request
    .input('userId', sql.UniqueIdentifier, userId)
    .input('offset', sql.Int, (page - 1) * pageSize)
    .input('limit', sql.Int, pageSize)
    .query<DatasetRow & { total_count: number }>(
      `SELECT *, COUNT(*) OVER() AS total_count
         FROM dbo.datasets
        WHERE user_id = @userId
        ORDER BY created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    );

  return {
    items: result.recordset,
    total: result.recordset[0]?.total_count ?? 0,
  };
}

export async function deleteDataset(datasetId: string, userId: string): Promise<boolean> {
  const request = await createRequest();
  const result = await request
    .input('id', sql.UniqueIdentifier, datasetId)
    .input('userId', sql.UniqueIdentifier, userId)
    .query('DELETE FROM dbo.datasets WHERE id = @id AND user_id = @userId');
  return result.rowsAffected[0] === 1;
}
