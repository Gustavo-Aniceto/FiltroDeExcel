import { z } from 'zod';
import { columnNameSchema } from './common.js';
import { collectFilterColumns, filterSchema, type FilterNode } from './filters.js';

/**
 * ============================================================================
 * RECEITA - a unidade salva e reexecutavel do sistema
 * ============================================================================
 * Uma Receita unifica, num unico conceito, tres coisas que o pedido original
 * descrevia como telas separadas:
 *
 *   "filtros salvos"  +  "tratamento de dados"  +  "analises"
 *
 * Trata-las separadamente duplicaria codigo e, pior, impediria o caso de uso
 * real: "filtre os aprovados, remova duplicados, e SOME a coluna valor".
 * A ordem dos passos importa e precisa ser expressavel.
 * ============================================================================
 */

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const CAST_TARGETS = ['text', 'number', 'date', 'boolean'] as const;

const stepBase = { id: z.string().max(64).optional() };

/** Mantem apenas as linhas que satisfazem a arvore de filtros. */
export const filterStepSchema = z.object({
  ...stepBase,
  kind: z.literal('filter'),
  filter: filterSchema,
});

/**
 * Remove duplicados. `columns` vazio = linha inteira duplicada.
 * `keep: 'none'` descarta TODAS as ocorrencias -- util para auditoria, quando
 * o objetivo e isolar registros problematicos, nao ficar com um deles.
 */
export const dropDuplicatesStepSchema = z.object({
  ...stepBase,
  kind: z.literal('drop_duplicates'),
  columns: z.array(columnNameSchema).max(100).default([]),
  keep: z.enum(['first', 'last', 'none']).default('first'),
});

/** `mode: 'all'` remove so a linha 100% vazia; `'any'` remove se qualquer coluna estiver vazia. */
export const dropEmptyRowsStepSchema = z.object({
  ...stepBase,
  kind: z.literal('drop_empty_rows'),
  columns: z.array(columnNameSchema).max(100).default([]),
  mode: z.enum(['all', 'any']).default('all'),
});

export const selectColumnsStepSchema = z.object({
  ...stepBase,
  kind: z.literal('select_columns'),
  columns: z.array(columnNameSchema).min(1).max(500),
});

export const dropColumnsStepSchema = z.object({
  ...stepBase,
  kind: z.literal('drop_columns'),
  columns: z.array(columnNameSchema).min(1).max(500),
});

export const renameColumnsStepSchema = z.object({
  ...stepBase,
  kind: z.literal('rename_columns'),
  mapping: z
    .array(z.object({ from: columnNameSchema, to: columnNameSchema }))
    .min(1)
    .max(500),
});

export const sortStepSchema = z.object({
  ...stepBase,
  kind: z.literal('sort'),
  by: z
    .array(
      z.object({
        column: columnNameSchema,
        direction: z.enum(SORT_DIRECTIONS).default('asc'),
      }),
    )
    .min(1)
    .max(10),
});

export const castStepSchema = z.object({
  ...stepBase,
  kind: z.literal('cast'),
  column: columnNameSchema,
  to: z.enum(CAST_TARGETS),
  /** Formato de data de origem, ex.: 'DD/MM/YYYY'. So se aplica a `to: 'date'`. */
  format: z.string().max(50).optional(),
});

export const replaceValuesStepSchema = z.object({
  ...stepBase,
  kind: z.literal('replace_values'),
  column: columnNameSchema,
  mode: z.enum(['exact', 'contains']).default('exact'),
  replacements: z
    .array(z.object({ from: z.string().max(1000), to: z.string().max(1000) }))
    .min(1)
    .max(200),
});

export const fillEmptyStepSchema = z.object({
  ...stepBase,
  kind: z.literal('fill_empty'),
  column: columnNameSchema,
  value: z.union([z.string().max(1000), z.number(), z.boolean()]),
});

export const recipeStepSchema = z.discriminatedUnion('kind', [
  filterStepSchema,
  dropDuplicatesStepSchema,
  dropEmptyRowsStepSchema,
  selectColumnsStepSchema,
  dropColumnsStepSchema,
  renameColumnsStepSchema,
  sortStepSchema,
  castStepSchema,
  replaceValuesStepSchema,
  fillEmptyStepSchema,
]);
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type RecipeStepKind = RecipeStep['kind'];

export const STEP_LABELS: Record<RecipeStepKind, string> = {
  filter: 'Filtrar registros',
  drop_duplicates: 'Remover duplicados',
  drop_empty_rows: 'Remover linhas vazias',
  select_columns: 'Manter apenas colunas',
  drop_columns: 'Remover colunas',
  rename_columns: 'Renomear colunas',
  sort: 'Ordenar',
  cast: 'Converter tipo',
  replace_values: 'Substituir valores',
  fill_empty: 'Preencher vazios',
};

/**
 * Operacoes de analise. `count` e a unica que dispensa coluna (conta linhas).
 */
export const METRIC_OPERATIONS = [
  'count', 'count_distinct', 'count_empty',
  'sum', 'avg', 'min', 'max', 'median', 'percentage',
] as const;
export type MetricOperation = (typeof METRIC_OPERATIONS)[number];

export const METRIC_LABELS: Record<MetricOperation, string> = {
  count: 'Contagem',
  count_distinct: 'Contagem de valores unicos',
  count_empty: 'Contagem de vazios',
  sum: 'Soma',
  avg: 'Media',
  min: 'Minimo',
  max: 'Maximo',
  median: 'Mediana',
  percentage: 'Percentual do total',
};

/** Operacoes que exigem coluna numerica. */
export const NUMERIC_METRIC_OPERATIONS: readonly MetricOperation[] = [
  'sum', 'avg', 'min', 'max', 'median',
];

export const metricSchema = z
  .object({
    id: z.string().min(1).max(64),
    operation: z.enum(METRIC_OPERATIONS),
    /** Obrigatoria para tudo, exceto `count`. */
    column: columnNameSchema.optional(),
    /** Rotulo exibido. Sem ele, geramos um a partir da operacao e da coluna. */
    label: z.string().max(200).optional(),
    format: z.enum(['number', 'currency', 'percent', 'integer']).optional(),
  })
  .superRefine((metric, ctx) => {
    if (metric.operation !== 'count' && !metric.column) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['column'],
        message: `A operacao "${METRIC_LABELS[metric.operation]}" exige uma coluna`,
      });
    }
  });
export type Metric = z.infer<typeof metricSchema>;

export const MAX_RECIPE_STEPS = 50;
export const MAX_RECIPE_METRICS = 50;

/** O documento completo. E isto que a tabela `recipe_versions` versiona. */
export const recipeSchema = z.object({
  version: z.literal(1),
  steps: z.array(recipeStepSchema).max(MAX_RECIPE_STEPS).default([]),
  metrics: z.array(metricSchema).max(MAX_RECIPE_METRICS).default([]),
});
export type Recipe = z.infer<typeof recipeSchema>;

export function emptyRecipe(): Recipe {
  return { version: 1, steps: [], metrics: [] };
}

/**
 * Todas as colunas citadas por uma receita.
 *
 * O engine usa isto para rejeitar a receita ANTES de gerar SQL, quando ela
 * referencia uma coluna que nao existe no dataset -- o que acontece de forma
 * legitima ao reaplicar uma receita salva a uma planilha de estrutura
 * diferente. O erro precisa ser claro ("a coluna X nao existe nesta
 * planilha"), nao um erro de SQL.
 */
export function collectRecipeColumns(recipe: Recipe): Set<string> {
  const columns = new Set<string>();
  const add = (c: string) => columns.add(c);

  for (const step of recipe.steps) {
    switch (step.kind) {
      case 'filter':
        collectFilterColumns(step.filter as FilterNode).forEach(add);
        break;
      case 'drop_duplicates':
      case 'drop_empty_rows':
      case 'select_columns':
      case 'drop_columns':
        step.columns.forEach(add);
        break;
      case 'rename_columns':
        step.mapping.forEach((m) => add(m.from));
        break;
      case 'sort':
        step.by.forEach((s) => add(s.column));
        break;
      case 'cast':
      case 'replace_values':
      case 'fill_empty':
        add(step.column);
        break;
    }
  }
  for (const metric of recipe.metrics) {
    if (metric.column) add(metric.column);
  }
  return columns;
}

/** Rotulo padrao de uma metrica, quando o usuario nao informou um. */
export function defaultMetricLabel(metric: Metric): string {
  if (metric.label) return metric.label;
  if (metric.operation === 'count') return 'Contagem de registros';
  return `${METRIC_LABELS[metric.operation]} de ${metric.column}`;
}
