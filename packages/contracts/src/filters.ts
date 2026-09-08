import { z } from 'zod';
import { columnNameSchema } from './common.js';

/**
 * ============================================================================
 * AST DE FILTROS
 * ============================================================================
 * Um filtro e uma ARVORE, nao uma lista. E isso que permite expressar
 *
 *   (Status = APROVADO E Valor > 500) OU (Status = PENDENTE E Valor > 1000)
 *
 * que era um requisito explicito. Uma lista plana de condicoes com um unico
 * conectivo global nunca conseguiria representar isso.
 * ============================================================================
 */

/** Operadores que NAO recebem valor algum. */
export const NULLARY_OPERATORS = ['is_empty', 'is_not_empty', 'is_true', 'is_false'] as const;

/** Operadores que recebem exatamente um valor. */
export const UNARY_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'greater_or_equal',
  'less_than',
  'less_or_equal',
  'date_equals',
  'date_before',
  'date_after',
] as const;

/** Operadores que recebem uma lista de valores. */
export const LIST_OPERATORS = ['in', 'not_in'] as const;

/** Operadores que recebem um intervalo [inicio, fim]. */
export const RANGE_OPERATORS = ['between', 'date_between'] as const;

export const FILTER_OPERATORS = [
  ...NULLARY_OPERATORS,
  ...UNARY_OPERATORS,
  ...LIST_OPERATORS,
  ...RANGE_OPERATORS,
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Rotulos em portugues, usados na interface e no resumo do relatorio. */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: 'igual a',
  not_equals: 'diferente de',
  contains: 'contem',
  not_contains: 'nao contem',
  starts_with: 'comeca com',
  ends_with: 'termina com',
  in: 'esta em',
  not_in: 'nao esta em',
  greater_than: 'maior que',
  greater_or_equal: 'maior ou igual a',
  less_than: 'menor que',
  less_or_equal: 'menor ou igual a',
  between: 'entre',
  date_equals: 'data igual a',
  date_before: 'data antes de',
  date_after: 'data depois de',
  date_between: 'periodo entre',
  is_empty: 'esta vazio',
  is_not_empty: 'nao esta vazio',
  is_true: 'e verdadeiro',
  is_false: 'e falso',
};

/**
 * Um valor escalar de filtro. Datas trafegam como string ISO-8601: JSON nao
 * tem tipo de data, e serializar Date implicitamente e fonte classica de bug
 * de fuso horario.
 */
export const filterValueSchema = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);
export type FilterValue = z.infer<typeof filterValueSchema>;

const baseCondition = z.object({
  type: z.literal('condition'),
  /** Estavel entre renders da interface; util para React keys e para edicao. */
  id: z.string().max(64).optional(),
  column: columnNameSchema,
  /**
   * Comparacao de texto ignora maiusculas/minusculas por padrao.
   *
   * Deliberadamente `.optional()` e nao `.default(false)`: o schema e
   * recursivo, e um default faz o tipo de ENTRADA divergir do de SAIDA --
   * divergencia que o TypeScript nao consegue reconciliar numa definicao
   * recursiva. Ausente significa insensivel a caixa.
   */
  caseSensitive: z.boolean().optional(),
});

/**
 * A forma do campo de valor depende do operador, e o schema precisa refletir
 * isso: `{ operator: "between", value: 5 }` tem que ser rejeitado no contrato,
 * nao descoberto la na frente pelo compilador de SQL.
 *
 * Agrupamos os operadores por ARIDADE (quantos valores consomem) e usamos uma
 * uniao discriminada sobre `operator`. Quatro variantes cobrem os 21
 * operadores, e o TypeScript continua estreitando o tipo corretamente ao
 * comparar `operator` com um literal.
 */
const nullaryConditionSchema = baseCondition.extend({
  operator: z.enum(NULLARY_OPERATORS),
});

const unaryConditionSchema = baseCondition.extend({
  operator: z.enum(UNARY_OPERATORS),
  value: filterValueSchema,
});

const listConditionSchema = baseCondition.extend({
  operator: z.enum(LIST_OPERATORS),
  values: z.array(filterValueSchema).min(1).max(1000),
});

const rangeConditionSchema = baseCondition.extend({
  operator: z.enum(RANGE_OPERATORS),
  /** [inicio, fim], ambos inclusivos. */
  range: z.tuple([filterValueSchema, filterValueSchema]),
});

export const filterConditionSchema = z.discriminatedUnion('operator', [
  nullaryConditionSchema,
  unaryConditionSchema,
  listConditionSchema,
  rangeConditionSchema,
]);

export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const LOGIC_OPERATORS = ['AND', 'OR'] as const;
export type LogicOperator = (typeof LOGIC_OPERATORS)[number];

export interface FilterGroup {
  type: 'group';
  id?: string;
  logic: LogicOperator;
  children: FilterNode[];
  /** Nega o grupo inteiro: NOT (...). */
  negate?: boolean;
}

export type FilterNode = FilterCondition | FilterGroup;

/**
 * Limites contra arvores patologicas.
 *
 * Sem eles, um cliente malicioso (ou a IA da Fase 10 alucinando) poderia
 * montar um filtro com milhares de niveis e derrubar o motor de consulta.
 */
export const MAX_FILTER_DEPTH = 6;
export const MAX_FILTER_NODES = 200;

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    id: z.string().max(64).optional(),
    logic: z.enum(LOGIC_OPERATORS),
    negate: z.boolean().optional(),
    children: z.array(filterNodeSchema).max(MAX_FILTER_NODES),
  }),
);

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([filterConditionSchema, filterGroupSchema]),
);

/** Percorre a arvore medindo profundidade e quantidade de nos. */
export function measureFilterTree(node: FilterNode, depth = 1): { depth: number; nodes: number } {
  if (node.type === 'condition') return { depth, nodes: 1 };
  let maxDepth = depth;
  let nodes = 1;
  for (const child of node.children) {
    const m = measureFilterTree(child, depth + 1);
    if (m.depth > maxDepth) maxDepth = m.depth;
    nodes += m.nodes;
  }
  return { depth: maxDepth, nodes };
}

/** Schema publico do filtro: estrutura valida E dentro dos limites de tamanho. */
export const filterSchema = filterGroupSchema.superRefine((node, ctx) => {
  const { depth, nodes } = measureFilterTree(node);
  if (depth > MAX_FILTER_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `O filtro excede a profundidade maxima de ${MAX_FILTER_DEPTH} niveis`,
    });
  }
  if (nodes > MAX_FILTER_NODES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `O filtro excede o maximo de ${MAX_FILTER_NODES} condicoes`,
    });
  }
});

/** Coleta todas as colunas citadas na arvore (para validar contra o dataset). */
export function collectFilterColumns(node: FilterNode, out: Set<string> = new Set()): Set<string> {
  if (node.type === 'condition') {
    out.add(node.column);
  } else {
    for (const child of node.children) collectFilterColumns(child, out);
  }
  return out;
}

/** Grupo AND vazio: ponto de partida neutro da interface. */
export function emptyFilterGroup(): FilterGroup {
  return { type: 'group', logic: 'AND', children: [] };
}
