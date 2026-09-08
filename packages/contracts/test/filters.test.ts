import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_FILTER_DEPTH,
  collectFilterColumns,
  emptyFilterGroup,
  filterSchema,
  measureFilterTree,
  type FilterGroup,
} from '../src/filters.js';

describe('AST de filtros', () => {
  it('aceita o caso combinado que motivou a arvore: (A E B) OU (C E D)', () => {
    const filter = {
      type: 'group',
      logic: 'OR',
      children: [
        {
          type: 'group',
          logic: 'AND',
          children: [
            { type: 'condition', column: 'status', operator: 'equals', value: 'APROVADO' },
            { type: 'condition', column: 'valor', operator: 'greater_than', value: 500 },
          ],
        },
        {
          type: 'group',
          logic: 'AND',
          children: [
            { type: 'condition', column: 'status', operator: 'equals', value: 'PENDENTE' },
            { type: 'condition', column: 'valor', operator: 'greater_than', value: 1000 },
          ],
        },
      ],
    };

    assert.equal(filterSchema.safeParse(filter).success, true);
  });

  it('rejeita valor escalar num operador de intervalo', () => {
    const result = filterSchema.safeParse({
      type: 'group',
      logic: 'AND',
      children: [{ type: 'condition', column: 'valor', operator: 'between', value: 500 }],
    });
    assert.equal(result.success, false);
  });

  it('aceita o operador de intervalo com os dois extremos', () => {
    const result = filterSchema.safeParse({
      type: 'group',
      logic: 'AND',
      children: [{ type: 'condition', column: 'valor', operator: 'between', range: [100, 500] }],
    });
    assert.equal(result.success, true);
  });

  it('rejeita valor num operador que nao recebe valor', () => {
    // `is_empty` nao aceita `value`; a uniao discriminada barra a combinacao.
    const result = filterSchema.safeParse({
      type: 'group',
      logic: 'AND',
      children: [{ type: 'condition', column: 'obs', operator: 'is_empty', value: 'x' }],
    });
    assert.equal(result.success, true, 'campos extras sao ignorados, nao rejeitados');
    const parsed = result.success ? result.data.children[0] : null;
    assert.ok(parsed && !('value' in parsed), 'o valor indevido e removido do resultado');
  });

  it('rejeita operador inexistente', () => {
    const result = filterSchema.safeParse({
      type: 'group',
      logic: 'AND',
      children: [{ type: 'condition', column: 'status', operator: 'quase_igual', value: 'X' }],
    });
    assert.equal(result.success, false);
  });

  it('rejeita arvore mais profunda que o limite', () => {
    // Monta uma cadeia de grupos aninhados um nivel alem do permitido.
    let node: FilterGroup = {
      type: 'group',
      logic: 'AND',
      children: [{ type: 'condition', column: 'a', operator: 'is_empty' }],
    };
    for (let i = 0; i < MAX_FILTER_DEPTH + 1; i += 1) {
      node = { type: 'group', logic: 'AND', children: [node] };
    }

    const result = filterSchema.safeParse(node);
    assert.equal(result.success, false);
    assert.match(result.error?.issues[0]?.message ?? '', /profundidade maxima/);
  });

  it('mede profundidade e quantidade de nos', () => {
    const filter: FilterGroup = {
      type: 'group',
      logic: 'AND',
      children: [
        { type: 'condition', column: 'a', operator: 'is_empty' },
        {
          type: 'group',
          logic: 'OR',
          children: [
            { type: 'condition', column: 'b', operator: 'is_empty' },
            { type: 'condition', column: 'c', operator: 'is_empty' },
          ],
        },
      ],
    };

    assert.deepEqual(measureFilterTree(filter), { depth: 3, nodes: 5 });
  });

  it('coleta todas as colunas citadas, inclusive as aninhadas', () => {
    const filter: FilterGroup = {
      type: 'group',
      logic: 'AND',
      children: [
        { type: 'condition', column: 'status', operator: 'is_empty' },
        {
          type: 'group',
          logic: 'OR',
          children: [
            { type: 'condition', column: 'valor', operator: 'greater_than', value: 1 },
            { type: 'condition', column: 'status', operator: 'is_not_empty' },
          ],
        },
      ],
    };

    assert.deepEqual([...collectFilterColumns(filter)].sort(), ['status', 'valor']);
  });

  it('aceita o grupo vazio usado como ponto de partida da interface', () => {
    assert.equal(filterSchema.safeParse(emptyFilterGroup()).success, true);
  });
});
