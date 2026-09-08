import { randomUUID } from 'node:crypto';
import type {
  ExportFormat,
  Metric,
  MetricResult,
  PreviewRequest,
  Recipe,
} from '@excelflow/contracts';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import {
  engineColumnValues,
  engineExport,
  enginePreview,
  engineSuggestedMetrics,
  type MetricResultRaw,
} from '../../lib/engine-client.js';
import { writeAuditLog } from '../auth/auth.repository.js';
import * as executionsRepo from '../executions/executions.repository.js';
import * as recipesRepo from '../recipes/recipes.repository.js';
import { loadDatasetContext } from './dataset-context.js';

export interface RequestContext {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PreviewResponse {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  inputRows: number;
  metrics: Array<MetricResult & { error: string | null }>;
  durationMs: number;
}

function toMetricResults(raw: MetricResultRaw[]): Array<MetricResult & { error: string | null }> {
  return raw.map((metric) => ({
    id: metric.id,
    label: metric.label,
    operation: metric.operation,
    column: metric.column,
    value: metric.value,
    format: metric.format as MetricResult['format'],
    error: metric.error,
  }));
}

/**
 * Previa: executa a receita SEM registrar no historico.
 *
 * E chamada a cada ajuste de filtro enquanto o usuario monta as regras. Gravar
 * cada uma dessas no historico o encheria de ruido e tornaria inutil a tela que
 * deveria mostrar os processamentos que importam.
 */
export async function preview(
  datasetId: string,
  input: PreviewRequest & { search?: string | null; metrics?: Metric[] },
  context: RequestContext,
): Promise<PreviewResponse> {
  const dataset = await loadDatasetContext(datasetId, context.userId);

  const result = await enginePreview({
    parquetPath: dataset.parquetPath,
    columns: dataset.engineColumns,
    recipe: input.recipe,
    page: input.page,
    pageSize: input.pageSize,
    search: input.search ?? null,
    metrics: input.metrics ?? input.recipe.metrics ?? [],
  });

  return {
    columns: result.columns,
    rows: result.rows,
    totalRows: result.totalRows,
    inputRows: result.inputRows,
    metrics: toMetricResults(result.metrics),
    durationMs: result.durationMs,
  };
}

export async function columnValues(
  datasetId: string,
  column: string,
  search: string | null,
  context: RequestContext,
): Promise<Array<{ value: string; count: number }>> {
  const dataset = await loadDatasetContext(datasetId, context.userId);
  const { values } = await engineColumnValues({
    parquetPath: dataset.parquetPath,
    columns: dataset.engineColumns,
    recipe: { version: 1, steps: [], metrics: [] },
    column,
    search,
  });
  return values;
}

export async function suggestedMetrics(
  datasetId: string,
  context: RequestContext,
): Promise<unknown[]> {
  const dataset = await loadDatasetContext(datasetId, context.userId);
  const { metrics } = await engineSuggestedMetrics({
    parquetPath: dataset.parquetPath,
    columns: dataset.engineColumns,
    recipe: { version: 1, steps: [], metrics: [] },
  });
  return metrics;
}

/**
 * Executa a receita e REGISTRA no historico.
 *
 * Diferente da previa: aqui o usuario declarou que aquele processamento e o
 * resultado que ele quer. Fica gravado com o snapshot da receita, para poder
 * ser reaberto depois e auditado.
 */
export async function execute(
  datasetId: string,
  input: { recipe: Recipe; recipeId?: string | null; metrics?: Metric[] },
  context: RequestContext,
): Promise<PreviewResponse & { executionId: string }> {
  const dataset = await loadDatasetContext(datasetId, context.userId);

  let recipeName: string | null = null;
  let recipeVersionId: string | null = null;
  if (input.recipeId) {
    const stored = await recipesRepo.findRecipe(input.recipeId, context.userId);
    if (stored) {
      recipeName = stored.name;
      recipeVersionId = stored.current_version_id;
    }
  }

  const started = Date.now();
  const metrics = input.metrics ?? input.recipe.metrics ?? [];

  try {
    const result = await enginePreview({
      parquetPath: dataset.parquetPath,
      columns: dataset.engineColumns,
      recipe: input.recipe,
      page: 1,
      pageSize: 50,
      metrics,
    });

    const executionId = await executionsRepo.recordExecution({
      userId: context.userId,
      datasetId: dataset.datasetId,
      datasetName: dataset.originalFilename,
      recipeId: input.recipeId ?? null,
      recipeVersionId,
      recipeName,
      definition: input.recipe,
      status: 'succeeded',
      inputRowCount: result.inputRows,
      outputRowCount: result.totalRows,
      durationMs: Date.now() - started,
      errorMessage: null,
      metrics: toMetricResults(result.metrics),
    });

    await writeAuditLog({
      userId: context.userId,
      action: 'execution.run',
      entityType: 'execution',
      entityId: executionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      // Registramos forma e volume, nunca conteudo de celula.
      metadata: { inputRows: result.inputRows, outputRows: result.totalRows },
    });

    return {
      executionId,
      columns: result.columns,
      rows: result.rows,
      totalRows: result.totalRows,
      inputRows: result.inputRows,
      metrics: toMetricResults(result.metrics),
      durationMs: result.durationMs,
    };
  } catch (error) {
    // A falha tambem entra no historico. Saber que uma regra falhou -- e por
    // que -- e tao importante quanto saber que deu certo.
    await executionsRepo.recordExecution({
      userId: context.userId,
      datasetId: dataset.datasetId,
      datasetName: dataset.originalFilename,
      recipeId: input.recipeId ?? null,
      recipeVersionId,
      recipeName,
      definition: input.recipe,
      status: 'failed',
      inputRowCount: dataset.rowCount,
      outputRowCount: 0,
      durationMs: Date.now() - started,
      errorMessage: error instanceof AppError ? error.message : 'Falha ao executar as regras.',
      metrics: [],
    });
    throw error;
  }
}

export interface ExportOutcome {
  exportId: string;
  filename: string;
  rowCount: number;
  sizeBytes: number;
  format: ExportFormat;
}

export async function exportResult(
  datasetId: string,
  input: {
    recipe: Recipe;
    format: ExportFormat;
    columns?: string[];
    includeSummary: boolean;
    metrics?: Metric[];
    filename?: string;
    recipeId?: string | null;
  },
  context: RequestContext,
): Promise<ExportOutcome> {
  const dataset = await loadDatasetContext(datasetId, context.userId);
  const metrics = input.metrics ?? input.recipe.metrics ?? [];
  const started = Date.now();

  /**
   * Exportar e o momento em que o usuario declara "este e o meu resultado".
   *
   * E por isso que a EXPORTACAO registra a execucao no historico, e a previa
   * nao: a previa roda a cada tecla enquanto ele monta as regras, e gravar cada
   * uma encheria o historico de ruido justamente onde ele deveria mostrar os
   * processamentos que importaram.
   *
   * Rodamos a previa aqui de qualquer forma -- para as metricas do resumo e
   * para o historico --, mesmo quando o resumo esta desligado.
   */
  const computed = await enginePreview({
    parquetPath: dataset.parquetPath,
    columns: dataset.engineColumns,
    recipe: input.recipe,
    page: 1,
    pageSize: 1,
    metrics,
  });
  const computedMetrics = toMetricResults(computed.metrics);

  const summary =
    input.includeSummary && input.format === 'xlsx' && metrics.length > 0
      ? computedMetrics.filter((metric) => metric.error === null)
      : null;

  const result = await engineExport({
    parquetPath: dataset.parquetPath,
    columns: dataset.engineColumns,
    recipe: input.recipe,
    format: input.format,
    exportColumns: input.columns ?? null,
    summary,
    sourceName: dataset.originalFilename,
  });

  const base = (input.filename ?? dataset.originalFilename).replace(/\.[^.]+$/, '');
  const stamp = new Date().toISOString().slice(0, 10).split('-').reverse().join('-');
  const filename = `${base} - processado ${stamp}.${input.format}`;

  let recipeName: string | null = null;
  let recipeVersionId: string | null = null;
  if (input.recipeId) {
    const stored = await recipesRepo.findRecipe(input.recipeId, context.userId);
    if (stored) {
      recipeName = stored.name;
      recipeVersionId = stored.current_version_id;
    }
  }

  const executionId = await executionsRepo.recordExecution({
    userId: context.userId,
    datasetId: dataset.datasetId,
    datasetName: dataset.originalFilename,
    recipeId: input.recipeId ?? null,
    recipeVersionId,
    recipeName,
    definition: input.recipe,
    status: 'succeeded',
    inputRowCount: computed.inputRows,
    outputRowCount: result.rowCount,
    durationMs: Date.now() - started,
    errorMessage: null,
    metrics: computedMetrics,
  });

  const exportId = await executionsRepo.recordExport({
    userId: context.userId,
    executionId,
    filename,
    format: input.format,
    sizeBytes: result.sizeBytes,
    storagePath: result.path,
    rowCount: result.rowCount,
    // Exportacoes vencem MUITO antes dos datasets: sao copias derivadas, e o
    // usuario ja baixou o arquivo. Nao ha razao para mante-las no servidor.
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  });

  await writeAuditLog({
    userId: context.userId,
    action: 'export.create',
    entityType: 'export',
    entityId: exportId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    metadata: { format: input.format, rows: result.rowCount },
  });

  return {
    exportId,
    filename,
    rowCount: result.rowCount,
    sizeBytes: result.sizeBytes,
    format: input.format,
  };
}

export function exportExpiryHint(): string {
  return `Os arquivos exportados ficam disponiveis por 2 horas.`;
}

/** Nome de arquivo seguro para o cabecalho Content-Disposition. */
export function safeDownloadName(filename: string): string {
  return filename.replace(/["\r\n]/g, '').slice(0, 200) || `resultado-${randomUUID()}`;
}

export const DATASET_TTL_HOURS = env.DATASET_TTL_HOURS;
