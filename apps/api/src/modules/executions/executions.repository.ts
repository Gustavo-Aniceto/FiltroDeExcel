import type { Execution, ExecutionStatus, MetricResult, Recipe } from '@excelflow/contracts';
import { createRequest, getPool, sql } from '../../db/pool.js';

interface ExecutionRow {
  id: string;
  dataset_id: string | null;
  dataset_name: string;
  recipe_id: string | null;
  recipe_name: string | null;
  definition: string;
  status: ExecutionStatus;
  input_row_count: number;
  output_row_count: number;
  duration_ms: number;
  error_message: string | null;
  created_at: Date;
  created_by_name: string | null;
  total_count?: number;
}

function toExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    datasetId: row.dataset_id ?? '',
    datasetName: row.dataset_name,
    recipeId: row.recipe_id,
    recipeName: row.recipe_name,
    status: row.status,
    inputRowCount: row.input_row_count,
    outputRowCount: row.output_row_count,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    createdByName: row.created_by_name,
  };
}

/**
 * Registra uma execucao com o SNAPSHOT da receita executada.
 *
 * Guardamos a definicao inteira, e nao so a referencia a receita. Isso torna a
 * execucao reproduzivel mesmo que a regra seja editada ou excluida depois -- e
 * e o que permite abrir de novo um processamento antigo exatamente como ele
 * rodou. Tambem desnormalizamos o nome do arquivo: o dataset expira em 72h e o
 * historico precisa continuar legivel depois disso.
 */
export async function recordExecution(input: {
  userId: string;
  datasetId: string;
  datasetName: string;
  recipeId: string | null;
  recipeVersionId: string | null;
  recipeName: string | null;
  definition: Recipe;
  status: ExecutionStatus;
  inputRowCount: number;
  outputRowCount: number;
  durationMs: number;
  errorMessage: string | null;
  metrics: MetricResult[];
}): Promise<string> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const created = await new sql.Request(transaction)
      .input('userId', sql.UniqueIdentifier, input.userId)
      .input('datasetId', sql.UniqueIdentifier, input.datasetId)
      .input('datasetName', sql.NVarChar(400), input.datasetName)
      .input('recipeId', sql.UniqueIdentifier, input.recipeId)
      .input('recipeVersionId', sql.UniqueIdentifier, input.recipeVersionId)
      .input('recipeName', sql.NVarChar(200), input.recipeName)
      .input('definition', sql.NVarChar(sql.MAX), JSON.stringify(input.definition))
      .input('status', sql.VarChar(20), input.status)
      .input('inputRows', sql.Int, input.inputRowCount)
      .input('outputRows', sql.Int, input.outputRowCount)
      .input('duration', sql.Int, input.durationMs)
      .input('error', sql.NVarChar(2000), input.errorMessage?.slice(0, 2000) ?? null)
      .query<{ id: string }>(
        `INSERT INTO dbo.executions
           (user_id, dataset_id, dataset_name, recipe_id, recipe_version_id, recipe_name,
            definition, status, input_row_count, output_row_count, duration_ms,
            error_message, completed_at)
         OUTPUT inserted.id
         VALUES (@userId, @datasetId, @datasetName, @recipeId, @recipeVersionId, @recipeName,
                 @definition, @status, @inputRows, @outputRows, @duration,
                 @error, SYSUTCDATETIME())`,
      );

    const executionId = created.recordset[0]!.id;

    for (const metric of input.metrics) {
      await new sql.Request(transaction)
        .input('executionId', sql.UniqueIdentifier, executionId)
        .input('key', sql.NVarChar(64), metric.id)
        .input('label', sql.NVarChar(200), metric.label)
        .input('operation', sql.VarChar(30), metric.operation)
        .input('column', sql.NVarChar(255), metric.column)
        .input('value', sql.Decimal(38, 10), metric.value)
        .input('format', sql.VarChar(20), metric.format)
        .query(
          `INSERT INTO dbo.execution_metrics
             (execution_id, metric_key, label, operation, column_name, value, format)
           VALUES (@executionId, @key, @label, @operation, @column, @value, @format)`,
        );
    }

    await transaction.commit();
    return executionId;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listExecutions(
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ items: Execution[]; total: number }> {
  const request = await createRequest();
  const result = await request
    .input('userId', sql.UniqueIdentifier, userId)
    .input('offset', sql.Int, (page - 1) * pageSize)
    .input('limit', sql.Int, pageSize)
    .query<ExecutionRow>(
      `SELECT e.*, u.display_name AS created_by_name, COUNT(*) OVER() AS total_count
         FROM dbo.executions e
         LEFT JOIN dbo.users u ON u.id = e.user_id
        WHERE e.user_id = @userId
        ORDER BY e.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    );

  return {
    items: result.recordset.map(toExecution),
    total: result.recordset[0]?.total_count ?? 0,
  };
}

export async function findExecution(
  id: string,
  userId: string,
): Promise<{ execution: Execution; definition: Recipe; metrics: MetricResult[] } | null> {
  const request = await createRequest();
  const found = await request
    .input('id', sql.UniqueIdentifier, id)
    .input('userId', sql.UniqueIdentifier, userId)
    .query<ExecutionRow>(
      `SELECT e.*, u.display_name AS created_by_name
         FROM dbo.executions e
         LEFT JOIN dbo.users u ON u.id = e.user_id
        WHERE e.id = @id AND e.user_id = @userId`,
    );

  const row = found.recordset[0];
  if (!row) return null;

  const metricsRequest = await createRequest();
  const metricsResult = await metricsRequest
    .input('executionId', sql.UniqueIdentifier, id)
    .query<{
      metric_key: string;
      label: string;
      operation: string;
      column_name: string | null;
      value: number | null;
      format: string | null;
    }>(
      `SELECT metric_key, label, operation, column_name, value, format
         FROM dbo.execution_metrics WHERE execution_id = @executionId`,
    );

  return {
    execution: toExecution(row),
    definition: JSON.parse(row.definition) as Recipe,
    metrics: metricsResult.recordset.map((metric) => ({
      id: metric.metric_key,
      label: metric.label,
      operation: metric.operation,
      column: metric.column_name,
      // DECIMAL volta como string do driver TDS quando a precisao e alta.
      value: metric.value === null ? null : Number(metric.value),
      format: metric.format as MetricResult['format'],
    })),
  };
}

export async function recordExport(input: {
  userId: string;
  executionId: string | null;
  filename: string;
  format: string;
  sizeBytes: number;
  storagePath: string;
  rowCount: number;
  expiresAt: Date;
}): Promise<string> {
  const request = await createRequest();
  const result = await request
    .input('userId', sql.UniqueIdentifier, input.userId)
    .input('executionId', sql.UniqueIdentifier, input.executionId)
    .input('filename', sql.NVarChar(400), input.filename)
    .input('format', sql.VarChar(10), input.format)
    .input('sizeBytes', sql.BigInt, input.sizeBytes)
    .input('storagePath', sql.NVarChar(500), input.storagePath)
    .input('rowCount', sql.Int, input.rowCount)
    .input('expiresAt', sql.DateTime2(3), input.expiresAt)
    .query<{ id: string }>(
      `INSERT INTO dbo.exports
         (user_id, execution_id, filename, format, size_bytes, storage_path, row_count, expires_at)
       OUTPUT inserted.id
       VALUES (@userId, @executionId, @filename, @format, @sizeBytes, @storagePath, @rowCount, @expiresAt)`,
    );
  return result.recordset[0]!.id;
}

export async function findExport(
  id: string,
  userId: string,
): Promise<{ filename: string; format: string; storage_path: string } | null> {
  const request = await createRequest();
  const result = await request
    .input('id', sql.UniqueIdentifier, id)
    .input('userId', sql.UniqueIdentifier, userId)
    .query<{ filename: string; format: string; storage_path: string }>(
      `SELECT filename, format, storage_path FROM dbo.exports
        WHERE id = @id AND user_id = @userId`,
    );
  return result.recordset[0] ?? null;
}

/**
 * Contabiliza um download. Falha aqui NUNCA impede o download.
 *
 * Isto e escrituracao de auditoria, nao o caminho critico. Deixar uma falha de
 * banco propagar significaria o usuario nao conseguir baixar o arquivo que o
 * sistema acabou de gerar -- exatamente o que aconteceu quando esta coluna
 * ainda nao existia. O erro vai para o log e a resposta segue.
 */
export async function markExportDownloaded(id: string): Promise<void> {
  try {
    const request = await createRequest();
    await request
      .input('id', sql.UniqueIdentifier, id)
      .query(
        `UPDATE dbo.exports
            SET download_count = download_count + 1, downloaded_at = SYSUTCDATETIME()
          WHERE id = @id`,
      );
  } catch (error) {
    console.error('Falha ao registrar download da exportacao', id, error);
  }
}
