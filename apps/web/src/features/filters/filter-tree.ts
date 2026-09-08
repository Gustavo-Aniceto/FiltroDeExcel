import type { ColumnProfile, FilterCondition, FilterGroup, FilterNode } from '@excelflow/contracts';
import { OPERATORS_BY_TYPE } from '@excelflow/contracts';

/**
 * Operacoes imutaveis sobre a arvore de filtros.
 *
 * A arvore vem do estado do React e nunca e mutada no lugar: cada alteracao
 * produz uma arvore nova. Mutar impediria o React de detectar a mudanca, e a
 * tela nao atualizaria depois de editar uma condicao aninhada.
 */

let counter = 0;

/** Id estavel para React keys. Nao vai para o servidor com significado algum. */
export function nextId(): string {
  counter += 1;
  return `n${counter}-${Date.now().toString(36)}`;
}

export function newCondition(column: ColumnProfile): FilterCondition {
  const operator = (OPERATORS_BY_TYPE[column.type][0] ?? 'equals') as never;
  const base = { type: 'condition' as const, id: nextId(), column: column.name, operator };

  // Cada aridade de operador tem forma propria; comecar com a forma errada
  // faria o schema recusar antes mesmo de o usuario digitar algo.
  if (['in', 'not_in'].includes(operator)) return { ...base, values: [] } as FilterCondition;
  if (['between', 'date_between'].includes(operator)) {
    return { ...base, range: ['', ''] } as FilterCondition;
  }
  if (['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(operator)) {
    return base as FilterCondition;
  }
  return { ...base, value: '' } as FilterCondition;
}

export function replaceNode(group: FilterGroup, index: number, node: FilterNode): FilterGroup {
  const children = [...group.children];
  children[index] = node;
  return { ...group, children };
}

export function removeNode(group: FilterGroup, index: number): FilterGroup {
  return { ...group, children: group.children.filter((_, i) => i !== index) };
}

/** Conta as condicoes reais da arvore (ignora grupos). Alimenta o rotulo da aba. */
export function countConditions(node: FilterNode): number {
  if (node.type === 'condition') return 1;
  return node.children.reduce((total, child) => total + countConditions(child), 0);
}

/**
 * Uma condicao esta "pronta" quando tem valor onde o operador exige.
 *
 * Enviar uma condicao pela metade ao servidor devolveria erro de validacao a
 * cada tecla digitada. Em vez disso, filtramos as incompletas antes de enviar:
 * o resultado mostrado reflete o que ja foi preenchido, e a linha em edicao
 * simplesmente ainda nao conta.
 */
export function isConditionReady(condition: FilterCondition): boolean {
  const operator = condition.operator;

  if (['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(operator)) return true;

  if (['in', 'not_in'].includes(operator)) {
    return 'values' in condition && Array.isArray(condition.values) && condition.values.length > 0;
  }

  if (['between', 'date_between'].includes(operator)) {
    if (!('range' in condition)) return false;
    const [start, end] = condition.range;
    return start !== '' && start !== null && end !== '' && end !== null;
  }

  return 'value' in condition && condition.value !== '' && condition.value !== null;
}

/**
 * Remove condicoes incompletas e grupos que ficaram vazios.
 *
 * Devolve `null` quando nao sobrou nada -- o chamador entao omite o passo de
 * filtro inteiro da receita, em vez de enviar um grupo vazio.
 */
export function pruneIncomplete(node: FilterNode): FilterNode | null {
  if (node.type === 'condition') {
    return isConditionReady(node) ? node : null;
  }

  const children = node.children
    .map(pruneIncomplete)
    .filter((child): child is FilterNode => child !== null);

  return children.length > 0 ? { ...node, children } : null;
}
