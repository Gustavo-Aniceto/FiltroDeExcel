import { z } from 'zod';
import { recipeSchema } from './recipe.js';

export const EXECUTION_STATUS = ['queued', 'running', 'succeeded', 'failed'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUS)[number];

/** Valor calculado de uma metrica. */
export const metricResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  operation: z.string(),
  column: z.string().nullable(),
  /**
   * `null` quando indefinido (media de conjunto vazio, por exemplo).
   * Distinguir "zero" de "indefinido" importa: somar nada da 0, mas a media
   * de nada nao e 0.
   */
  value: z.number().nullable(),
  format: z.enum(['number', 'currency', 'percent', 'integer']).nullable(),
});
export type MetricResult = z.infer<typeof metricResultSchema>;

export const executionSchema = z.object({
  id: z.string().uuid(),
  datasetId: z.string().uuid(),
  datasetName: z.string(),
  recipeId: z.string().uuid().nullable(),
  recipeName: z.string().nullable(),
  status: z.enum(EXECUTION_STATUS),
  inputRowCount: z.number().int(),
  outputRowCount: z.number().int(),
  durationMs: z.number().int(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type Execution = z.infer<typeof executionSchema>;

export interface ExecutionResult {
  execution: Execution;
  metrics: MetricResult[];
  /** Colunas do resultado, ja considerando select/drop/rename. */
  columns: string[];
  /** Amostra das primeiras linhas. Nunca o resultado inteiro. */
  preview: Array<Record<string, unknown>>;
}

/** Requisicao de previa: executa a receita sem gravar no historico. */
export const previewRequestSchema = z.object({
  recipe: recipeSchema,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50),
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const exportRequestSchema = z.object({
  format: z.enum(EXPORT_FORMATS).default('xlsx'),
  /** Se ausente, exporta todas as colunas do resultado. */
  columns: z.array(z.string()).max(500).optional(),
  /** Adiciona a aba "Resumo" com as metricas. So faz sentido em xlsx. */
  includeSummary: z.boolean().default(true),
  filename: z.string().max(200).optional(),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;
