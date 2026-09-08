import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectRecipeColumns,
  defaultMetricLabel,
  emptyRecipe,
  metricSchema,
  recipeSchema,
} from '../src/recipe.js';

describe('Receita', () => {
  it('aceita a receita completa do caso de uso real', () => {
    const recipe = {
      version: 1,
      steps: [
        {
          kind: 'filter',
          filter: {
            type: 'group',
            logic: 'AND',
            children: [
              { type: 'condition', column: 'status', operator: 'equals', value: 'APROVADO' },
              { type: 'condition', column: 'valor', operator: 'greater_than', value: 500 },
            ],
          },
        },
        { kind: 'drop_duplicates', columns: ['documento'], keep: 'first' },
        { kind: 'sort', by: [{ column: 'valor', direction: 'desc' }] },
      ],
      metrics: [
        { id: 'qtd', operation: 'count' },
        { id: 'total', operation: 'sum', column: 'valor' },
      ],
    };

    const result = recipeSchema.safeParse(recipe);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  it('exige coluna em toda operacao exceto contagem', () => {
    assert.equal(metricSchema.safeParse({ id: 'a', operation: 'count' }).success, true);

    const semColuna = metricSchema.safeParse({ id: 'b', operation: 'sum' });
    assert.equal(semColuna.success, false);
    assert.match(semColuna.error?.issues[0]?.message ?? '', /exige uma coluna/);
  });

  it('coleta as colunas de passos e metricas, para validar contra o dataset', () => {
    // Este e o mecanismo que produz um erro claro ao reaplicar uma receita
    // salva numa planilha com estrutura diferente.
    const recipe = recipeSchema.parse({
      version: 1,
      steps: [
        { kind: 'select_columns', columns: ['documento', 'status'] },
        { kind: 'rename_columns', mapping: [{ from: 'valor_op', to: 'Valor' }] },
        { kind: 'fill_empty', column: 'banco', value: 'NAO INFORMADO' },
      ],
      metrics: [{ id: 'm', operation: 'avg', column: 'ticket' }],
    });

    assert.deepEqual(
      [...collectRecipeColumns(recipe)].sort(),
      ['banco', 'documento', 'status', 'ticket', 'valor_op'],
    );
  });

  it('rejeita um passo desconhecido', () => {
    const result = recipeSchema.safeParse({
      version: 1,
      steps: [{ kind: 'executar_sql', query: 'DROP TABLE users' }],
      metrics: [],
    });
    assert.equal(result.success, false);
  });

  it('gera rotulo padrao legivel quando o usuario nao informa um', () => {
    assert.equal(
      defaultMetricLabel({ id: 'a', operation: 'sum', column: 'Valor da operacao' }),
      'Soma de Valor da operacao',
    );
    assert.equal(defaultMetricLabel({ id: 'b', operation: 'count' }), 'Contagem de registros');
    assert.equal(
      defaultMetricLabel({ id: 'c', operation: 'avg', column: 'x', label: 'Ticket medio' }),
      'Ticket medio',
    );
  });

  it('a receita vazia e valida', () => {
    assert.equal(recipeSchema.safeParse(emptyRecipe()).success, true);
  });
});
