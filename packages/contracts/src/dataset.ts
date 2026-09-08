import { z } from 'zod';
import { columnNameSchema } from './common.js';

/**
 * Tipo logico inferido para uma coluna. Deliberadamente pequeno: e o que
 * governa quais operadores de filtro a interface oferece.
 *
 * `currency` e `number` no motor de calculo; a distincao existe para
 * formatacao (R$) e para o dashboard escolher o que somar automaticamente.
 */
export const COLUMN_TYPES = ['text', 'number', 'currency', 'date', 'boolean', 'empty'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const DATASET_STATUS = ['pending', 'processing', 'ready', 'failed', 'expired'] as const;
export type DatasetStatus = (typeof DATASET_STATUS)[number];

export const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

/** Perfil estatistico de uma coluna, calculado uma vez na ingestao. */
export const columnProfileSchema = z.object({
  name: columnNameSchema,
  /** Posicao original na planilha (0-based). */
  position: z.number().int().min(0),
  type: z.enum(COLUMN_TYPES),
  nullCount: z.number().int().min(0),
  distinctCount: z.number().int().min(0),
  /** Presentes apenas para colunas numericas/monetarias. */
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  sum: z.number().nullable().optional(),
  avg: z.number().nullable().optional(),
  /** Presentes apenas para colunas de data (ISO-8601). */
  minDate: z.string().nullable().optional(),
  maxDate: z.string().nullable().optional(),
  /**
   * Valores mais frequentes. Alimenta o autocomplete do construtor de filtros:
   * o usuario escolhe "APROVADO" numa lista em vez de digitar e errar.
   * Preenchido apenas quando a cardinalidade e baixa.
   */
  topValues: z.array(z.object({ value: z.string(), count: z.number().int() })).optional(),
  sampleValues: z.array(z.string()).optional(),
});
export type ColumnProfile = z.infer<typeof columnProfileSchema>;

export const datasetSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string(),
  extension: z.string(),
  sizeBytes: z.number().int(),
  rowCount: z.number().int(),
  columnCount: z.number().int(),
  /** Linhas totalmente duplicadas encontradas no perfilamento. */
  duplicateRowCount: z.number().int(),
  /** Linhas com ao menos uma celula vazia. */
  rowsWithEmptyCount: z.number().int(),
  sheetName: z.string().nullable(),
  status: z.enum(DATASET_STATUS),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type Dataset = z.infer<typeof datasetSchema>;

export interface DatasetProfile {
  dataset: Dataset;
  columns: ColumnProfile[];
}

/**
 * Operadores permitidos por tipo de coluna. A interface usa isso para nao
 * oferecer "comeca com" numa coluna de valores monetarios.
 */
export const OPERATORS_BY_TYPE: Record<ColumnType, readonly string[]> = {
  text: [
    'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
    'in', 'not_in', 'is_empty', 'is_not_empty',
  ],
  number: [
    'equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than',
    'less_or_equal', 'between', 'in', 'not_in', 'is_empty', 'is_not_empty',
  ],
  currency: [
    'equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than',
    'less_or_equal', 'between', 'is_empty', 'is_not_empty',
  ],
  date: [
    'date_equals', 'date_before', 'date_after', 'date_between', 'is_empty', 'is_not_empty',
  ],
  boolean: ['is_true', 'is_false', 'is_empty', 'is_not_empty'],
  empty: ['is_empty', 'is_not_empty'],
};
