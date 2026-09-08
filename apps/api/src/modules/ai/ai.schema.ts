/**
 * Este arquivo usa `zod/v4` -- e nao o `zod` classico do resto do projeto.
 *
 * O helper `zodOutputFormat` do SDK da Anthropic exige a API do Zod 4, que o
 * pacote zod 3.25 ja publica neste subpath. O escopo e proposital: o Zod 4 fica
 * confinado a FRONTEIRA com o modelo. A Receita produzida continua sendo
 * validada pelo `recipeSchema` do pacote de contratos, em Zod 3, igual a que
 * vem da interface visual -- uma unica autoridade sobre o que e valido.
 */
import * as z from 'zod/v4';
import {
  FILTER_OPERATORS,
  METRIC_OPERATIONS,
  type ColumnProfile,
  type FilterGroup,
  type FilterNode,
  type Recipe,
  type RecipeStep,
} from '@excelflow/contracts';

/**
 * ============================================================================
 * FORMA INTERMEDIARIA que o modelo produz
 * ============================================================================
 * Deliberadamente MAIS SIMPLES que a Receita final: plana, sem recursao.
 *
 * A Receita real tem uma arvore de filtros de profundidade arbitraria e unioes
 * discriminadas por operador. Pedir isso diretamente a um modelo aumenta a
 * chance de saida invalida sem ganho nenhum: pedidos em linguagem natural
 * ("aprovados acima de 500, ou pendentes acima de 1000") cabem em dois niveis.
 *
 * Entao o modelo produz esta forma reduzida, e o CODIGO -- deterministico,
 * testavel -- a converte na Receita completa. A conversao e o lugar certo para
 * a complexidade: ela nao alucina.
 */

const aiConditionSchema = z.object({
  column: z.string().describe('Nome exato da coluna, copiado da lista fornecida'),
  operator: z.enum(FILTER_OPERATORS),
  value: z
    .string()
    .nullable()
    .describe('Valor unico. Use para operadores de comparacao simples. Null quando nao se aplica.'),
  values: z
    .array(z.string())
    .nullable()
    .describe('Lista de valores. Use apenas com os operadores in e not_in.'),
  rangeStart: z
    .string()
    .nullable()
    .describe('Inicio do intervalo. Use apenas com between e date_between.'),
  rangeEnd: z.string().nullable().describe('Fim do intervalo.'),
});

const aiGroupSchema = z.object({
  conditions: z
    .array(aiConditionSchema)
    .describe('Condicoes combinadas com E (todas precisam ser verdadeiras)'),
});

const aiStepSchema = z.object({
  kind: z.enum([
    'drop_duplicates',
    'drop_empty_rows',
    'select_columns',
    'drop_columns',
    'sort',
    'fill_empty',
  ]),
  columns: z.array(z.string()).nullable().describe('Colunas afetadas, quando aplicavel'),
  keep: z
    .enum(['first', 'last', 'none'])
    .nullable()
    .describe('Para drop_duplicates: qual ocorrencia manter'),
  direction: z.enum(['asc', 'desc']).nullable().describe('Para sort: crescente ou decrescente'),
  value: z.string().nullable().describe('Para fill_empty: com o que preencher'),
});

const aiMetricSchema = z.object({
  operation: z.enum(METRIC_OPERATIONS),
  column: z.string().nullable().describe('Coluna analisada. Null para count e percentage.'),
  label: z.string().describe('Nome curto em portugues, para exibir no cartao'),
});

export const aiPlanSchema = z.object({
  /**
   * Grupos combinados com OU. Um unico grupo = apenas E, o caso mais comum.
   * Dois niveis cobrem "(A e B) ou (C e D)", que e o limite do que se expressa
   * confortavelmente em linguagem natural.
   */
  filterGroups: z.array(aiGroupSchema).describe('Grupos combinados com OU entre si'),
  steps: z.array(aiStepSchema).describe('Tratamentos a aplicar, na ordem'),
  metrics: z.array(aiMetricSchema).describe('Analises a calcular sobre o resultado'),
  explanation: z
    .string()
    .describe('Uma frase em portugues explicando o que sera feito, para o usuario conferir'),
  unsupported: z
    .array(z.string())
    .describe(
      'Partes do pedido que NAO foram traduzidas. Liste em vez de inventar uma aproximacao.',
    ),
});

export type AiPlan = z.infer<typeof aiPlanSchema>;

const NULLARY = new Set(['is_empty', 'is_not_empty', 'is_true', 'is_false']);
const LIST = new Set(['in', 'not_in']);
const RANGE = new Set(['between', 'date_between']);

export interface ConversionResult {
  recipe: Recipe;
  /** Problemas encontrados na conversao, mostrados ao usuario antes de aplicar. */
  warnings: string[];
}

/**
 * Converte o plano do modelo numa Receita valida.
 *
 * Aqui mora a defesa real: cada coluna citada e conferida contra as colunas do
 * dataset ANTES de virar Receita. Um nome inventado nao vira filtro -- vira
 * aviso ao usuario. Depois disso a Receita ainda passa pelo schema Zod e pelo
 * compilador, que revalidam tudo de novo.
 *
 * Nenhuma parte deste caminho executa SQL, codigo ou qualquer coisa vinda do
 * modelo. O que sai daqui e um documento de dados, igual ao que a interface
 * visual produz.
 */
export function planToRecipe(plan: AiPlan, columns: ColumnProfile[]): ConversionResult {
  const warnings: string[] = [];
  const byName = new Map(columns.map((column) => [column.name.toLowerCase(), column]));

  /** Resolve o nome citado pelo modelo para o nome REAL da coluna. */
  const resolve = (name: string): ColumnProfile | null => {
    const exact = byName.get(name.trim().toLowerCase());
    if (exact) return exact;

    // O modelo as vezes devolve "valor" para a coluna "Valor da operacao".
    // Aceitamos correspondencia parcial inequivoca -- se houver mais de uma
    // candidata, preferimos avisar a escolher errado.
    const needle = name.trim().toLowerCase();
    const partial = columns.filter(
      (column) =>
        column.name.toLowerCase().includes(needle) || needle.includes(column.name.toLowerCase()),
    );
    return partial.length === 1 ? partial[0]! : null;
  };

  // --- filtros ---
  const groups: FilterNode[] = [];

  for (const group of plan.filterGroups) {
    const children: FilterNode[] = [];

    for (const condition of group.conditions) {
      const column = resolve(condition.column);
      if (!column) {
        warnings.push(`A coluna "${condition.column}" nao existe nesta planilha e foi ignorada.`);
        continue;
      }

      const operator = condition.operator;
      const base = { type: 'condition' as const, column: column.name };

      if (NULLARY.has(operator)) {
        children.push({ ...base, operator } as FilterNode);
      } else if (LIST.has(operator)) {
        const values = condition.values ?? (condition.value ? [condition.value] : []);
        if (values.length === 0) {
          warnings.push(`A condicao sobre "${column.name}" ficou sem valores e foi ignorada.`);
          continue;
        }
        children.push({ ...base, operator, values } as FilterNode);
      } else if (RANGE.has(operator)) {
        if (condition.rangeStart === null || condition.rangeEnd === null) {
          warnings.push(`O intervalo sobre "${column.name}" ficou incompleto e foi ignorado.`);
          continue;
        }
        children.push({
          ...base,
          operator,
          range: [condition.rangeStart, condition.rangeEnd],
        } as FilterNode);
      } else {
        if (condition.value === null || condition.value === '') {
          warnings.push(`A condicao sobre "${column.name}" ficou sem valor e foi ignorada.`);
          continue;
        }
        children.push({ ...base, operator, value: condition.value } as FilterNode);
      }
    }

    if (children.length > 0) {
      groups.push({ type: 'group', logic: 'AND', children });
    }
  }

  const steps: RecipeStep[] = [];

  if (groups.length === 1) {
    // Um grupo so: nao envolvemos num OU desnecessario. A interface fica mais
    // limpa e o usuario ve exatamente o que pediu.
    steps.push({ kind: 'filter', filter: groups[0] as FilterGroup });
  } else if (groups.length > 1) {
    steps.push({ kind: 'filter', filter: { type: 'group', logic: 'OR', children: groups } });
  }

  // --- tratamentos ---
  for (const step of plan.steps) {
    const resolvedColumns = (step.columns ?? [])
      .map((name) => resolve(name)?.name)
      .filter((name): name is string => name !== undefined);

    switch (step.kind) {
      case 'drop_duplicates':
        steps.push({ kind: 'drop_duplicates', columns: resolvedColumns, keep: step.keep ?? 'first' });
        break;
      case 'drop_empty_rows':
        steps.push({ kind: 'drop_empty_rows', columns: resolvedColumns, mode: 'all' });
        break;
      case 'select_columns':
      case 'drop_columns':
        if (resolvedColumns.length === 0) {
          warnings.push('Um passo de selecao de colunas foi ignorado por nao citar coluna valida.');
          break;
        }
        steps.push({ kind: step.kind, columns: resolvedColumns });
        break;
      case 'sort':
        if (resolvedColumns.length === 0) {
          warnings.push('A ordenacao foi ignorada por nao citar uma coluna valida.');
          break;
        }
        steps.push({
          kind: 'sort',
          by: resolvedColumns.map((column) => ({ column, direction: step.direction ?? 'asc' })),
        });
        break;
      case 'fill_empty':
        if (resolvedColumns.length === 0 || step.value === null) {
          warnings.push('O preenchimento de vazios foi ignorado por estar incompleto.');
          break;
        }
        steps.push({ kind: 'fill_empty', column: resolvedColumns[0]!, value: step.value });
        break;
    }
  }

  // --- analises ---
  const metrics = plan.metrics.flatMap((metric, index) => {
    const columnless = metric.operation === 'count' || metric.operation === 'percentage';
    if (columnless) {
      return [{ id: `ai${index}`, operation: metric.operation, label: metric.label }];
    }

    const column = metric.column ? resolve(metric.column) : null;
    if (!column) {
      warnings.push(
        `A analise "${metric.label}" foi ignorada: a coluna citada nao existe nesta planilha.`,
      );
      return [];
    }

    return [
      {
        id: `ai${index}`,
        operation: metric.operation,
        column: column.name,
        label: metric.label,
        format: column.type === 'currency' ? ('currency' as const) : undefined,
      },
    ];
  });

  return { recipe: { version: 1, steps, metrics }, warnings };
}
