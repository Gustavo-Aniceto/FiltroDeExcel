import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ColumnProfile } from '@excelflow/contracts';
import { recipeSchema } from '@excelflow/contracts';
import { planToRecipe, type AiPlan } from '../src/modules/ai/ai.schema.js';

/**
 * Testes da conversao plano-do-modelo -> Receita.
 *
 * Esta e a fronteira de seguranca da Fase 10. O modelo pode devolver qualquer
 * coisa dentro do schema -- inclusive nomes de coluna que nao existem. O que
 * garante que nada perigoso passe e esta funcao, e ela precisa ser testada como
 * tal: nao "ela funciona", mas "ela recusa o que deve recusar".
 */

const COLUMNS: ColumnProfile[] = [
  { name: 'Documento', position: 0, type: 'text', nullCount: 0, distinctCount: 100 },
  { name: 'Status', position: 1, type: 'text', nullCount: 0, distinctCount: 4 },
  { name: 'Valor da operacao', position: 2, type: 'currency', nullCount: 0, distinctCount: 90 },
  { name: 'Data', position: 3, type: 'date', nullCount: 0, distinctCount: 50 },
];

function plan(overrides: Partial<AiPlan> = {}): AiPlan {
  return {
    filterGroups: [],
    steps: [],
    metrics: [],
    explanation: 'teste',
    unsupported: [],
    ...overrides,
  };
}

function condition(overrides: Record<string, unknown> = {}) {
  return {
    column: 'Status',
    operator: 'equals' as const,
    value: 'APROVADO',
    values: null,
    rangeStart: null,
    rangeEnd: null,
    ...overrides,
  };
}

describe('Conversao do plano da IA em Receita', () => {
  it('traduz o pedido tipico: aprovados acima de 500', () => {
    const { recipe, warnings } = planToRecipe(
      plan({
        filterGroups: [
          {
            conditions: [
              condition(),
              condition({ column: 'Valor da operacao', operator: 'greater_than', value: '500' }),
            ],
          },
        ],
      }),
      COLUMNS,
    );

    assert.equal(warnings.length, 0);
    assert.equal(recipe.steps.length, 1);
    const step = recipe.steps[0]!;
    assert.equal(step.kind, 'filter');
    if (step.kind !== 'filter') return;
    assert.equal(step.filter.logic, 'AND');
    assert.equal(step.filter.children.length, 2);
    // O resultado tem de passar pelo MESMO schema da interface visual.
    assert.equal(recipeSchema.safeParse(recipe).success, true);
  });

  it('dois grupos viram OU entre eles', () => {
    const { recipe } = planToRecipe(
      plan({
        filterGroups: [
          { conditions: [condition({ value: 'APROVADO' })] },
          { conditions: [condition({ value: 'PENDENTE' })] },
        ],
      }),
      COLUMNS,
    );

    const step = recipe.steps[0]!;
    if (step.kind !== 'filter') throw new Error('esperava um filtro');
    assert.equal(step.filter.logic, 'OR');
    assert.equal(step.filter.children.length, 2);
  });

  it('um grupo unico NAO e embrulhado num OU desnecessario', () => {
    // Envolver um grupo so num OU deixaria a interface confusa: o usuario veria
    // uma estrutura que nao pediu.
    const { recipe } = planToRecipe(
      plan({ filterGroups: [{ conditions: [condition()] }] }),
      COLUMNS,
    );
    const step = recipe.steps[0]!;
    if (step.kind !== 'filter') throw new Error('esperava um filtro');
    assert.equal(step.filter.logic, 'AND');
  });
});

describe('Defesa contra coluna inexistente', () => {
  it('coluna inventada pelo modelo vira AVISO, nao filtro', () => {
    // O caso que mais importa: o modelo alucina "Cliente" numa planilha que
    // nao tem essa coluna. O filtro nao pode ser criado, e o usuario precisa
    // saber -- silenciar produziria um resultado que parece certo e nao e.
    const { recipe, warnings } = planToRecipe(
      plan({ filterGroups: [{ conditions: [condition({ column: 'Cliente' })] }] }),
      COLUMNS,
    );

    assert.equal(recipe.steps.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Cliente.*nao existe/);
  });

  it('nome com SQL nao encontra coluna e vira aviso', () => {
    const { recipe, warnings } = planToRecipe(
      plan({
        filterGroups: [{ conditions: [condition({ column: '"; DROP TABLE users; --' })] }],
      }),
      COLUMNS,
    );
    assert.equal(recipe.steps.length, 0);
    assert.equal(warnings.length, 1);
  });

  it('condicoes validas sobrevivem quando uma e invalida', () => {
    // Uma coluna errada nao pode descartar o resto do pedido.
    const { recipe, warnings } = planToRecipe(
      plan({
        filterGroups: [
          { conditions: [condition(), condition({ column: 'NaoExiste' })] },
        ],
      }),
      COLUMNS,
    );

    const step = recipe.steps[0]!;
    if (step.kind !== 'filter') throw new Error('esperava um filtro');
    assert.equal(step.filter.children.length, 1);
    assert.equal(warnings.length, 1);
  });

  it('metrica sobre coluna inexistente e descartada com aviso', () => {
    const { recipe, warnings } = planToRecipe(
      plan({ metrics: [{ operation: 'sum', column: 'Inexistente', label: 'Total' }] }),
      COLUMNS,
    );
    assert.equal(recipe.metrics.length, 0);
    assert.equal(warnings.length, 1);
  });
});

describe('Correspondencia parcial de nome de coluna', () => {
  it('aceita "valor" para "Valor da operacao" quando nao ha ambiguidade', () => {
    // O modelo frequentemente abrevia. Aceitar a correspondencia unica evita
    // rejeitar um pedido perfeitamente valido por diferenca de fraseado.
    const { recipe, warnings } = planToRecipe(
      plan({
        filterGroups: [
          { conditions: [condition({ column: 'valor', operator: 'greater_than', value: '500' })] },
        ],
      }),
      COLUMNS,
    );

    assert.equal(warnings.length, 0);
    const step = recipe.steps[0]!;
    if (step.kind !== 'filter') throw new Error('esperava um filtro');
    const child = step.filter.children[0]!;
    if (child.type !== 'condition') throw new Error('esperava uma condicao');
    assert.equal(child.column, 'Valor da operacao');
  });

  it('recusa quando a abreviacao casa com mais de uma coluna', () => {
    // "data" casaria com "Data" e "Data de vencimento". Adivinhar produziria o
    // filtro errado sem aviso; preferimos avisar.
    const ambiguous: ColumnProfile[] = [
      ...COLUMNS,
      { name: 'Data de vencimento', position: 4, type: 'date', nullCount: 0, distinctCount: 30 },
    ];
    const { warnings } = planToRecipe(
      plan({
        filterGroups: [
          { conditions: [condition({ column: 'dat', operator: 'date_after', value: '2026-01-01' })] },
        ],
      }),
      ambiguous,
    );
    assert.equal(warnings.length, 1);
  });

  it('ignora diferenca de caixa', () => {
    const { warnings, recipe } = planToRecipe(
      plan({ filterGroups: [{ conditions: [condition({ column: 'STATUS' })] }] }),
      COLUMNS,
    );
    assert.equal(warnings.length, 0);
    assert.equal(recipe.steps.length, 1);
  });
});

describe('Formas por aridade de operador', () => {
  it('lista de valores', () => {
    const { recipe } = planToRecipe(
      plan({
        filterGroups: [
          {
            conditions: [
              condition({ operator: 'in', value: null, values: ['APROVADO', 'PENDENTE'] }),
            ],
          },
        ],
      }),
      COLUMNS,
    );
    assert.equal(recipeSchema.safeParse(recipe).success, true);
  });

  it('intervalo de datas', () => {
    const { recipe } = planToRecipe(
      plan({
        filterGroups: [
          {
            conditions: [
              condition({
                column: 'Data',
                operator: 'date_between',
                value: null,
                rangeStart: '2026-01-01',
                rangeEnd: '2026-03-31',
              }),
            ],
          },
        ],
      }),
      COLUMNS,
    );
    assert.equal(recipeSchema.safeParse(recipe).success, true);
  });

  it('operador sem valor', () => {
    const { recipe, warnings } = planToRecipe(
      plan({
        filterGroups: [{ conditions: [condition({ operator: 'is_empty', value: null })] }],
      }),
      COLUMNS,
    );
    assert.equal(warnings.length, 0);
    assert.equal(recipeSchema.safeParse(recipe).success, true);
  });

  it('intervalo incompleto e recusado com aviso', () => {
    const { recipe, warnings } = planToRecipe(
      plan({
        filterGroups: [
          {
            conditions: [
              condition({ operator: 'between', value: null, rangeStart: '100', rangeEnd: null }),
            ],
          },
        ],
      }),
      COLUMNS,
    );
    assert.equal(recipe.steps.length, 0);
    assert.match(warnings[0]!, /incompleto/);
  });

  it('valor ausente num operador que exige valor e recusado', () => {
    const { recipe, warnings } = planToRecipe(
      plan({ filterGroups: [{ conditions: [condition({ value: null })] }] }),
      COLUMNS,
    );
    assert.equal(recipe.steps.length, 0);
    assert.equal(warnings.length, 1);
  });
});

describe('Tratamentos e analises', () => {
  it('remocao de duplicados', () => {
    const { recipe } = planToRecipe(
      plan({
        steps: [
          {
            kind: 'drop_duplicates',
            columns: ['Documento'],
            keep: 'first',
            direction: null,
            value: null,
          },
        ],
      }),
      COLUMNS,
    );
    assert.equal(recipe.steps[0]?.kind, 'drop_duplicates');
    assert.equal(recipeSchema.safeParse(recipe).success, true);
  });

  it('metrica sem coluna e valida para contagem e percentual', () => {
    const { recipe, warnings } = planToRecipe(
      plan({
        metrics: [
          { operation: 'count', column: null, label: 'Quantos' },
          { operation: 'percentage', column: null, label: 'Percentual' },
        ],
      }),
      COLUMNS,
    );
    assert.equal(warnings.length, 0);
    assert.equal(recipe.metrics.length, 2);
    assert.equal(recipeSchema.safeParse(recipe).success, true);
  });

  it('metrica sobre coluna monetaria recebe formato de moeda', () => {
    const { recipe } = planToRecipe(
      plan({ metrics: [{ operation: 'sum', column: 'Valor da operacao', label: 'Total' }] }),
      COLUMNS,
    );
    assert.equal(recipe.metrics[0]?.format, 'currency');
  });

  it('plano vazio produz receita vazia e valida', () => {
    const { recipe, warnings } = planToRecipe(plan(), COLUMNS);
    assert.equal(warnings.length, 0);
    assert.deepEqual(recipe, { version: 1, steps: [], metrics: [] });
    assert.equal(recipeSchema.safeParse(recipe).success, true);
  });
});

describe('A receita produzida e sempre valida', () => {
  it('mesmo com um plano cheio de lixo, o que sai passa no schema', () => {
    // Simula um modelo se comportando mal: colunas inventadas, valores
    // ausentes, passos incompletos. Nada disso pode produzir uma Receita
    // invalida -- no maximo uma Receita vazia com avisos.
    const { recipe, warnings } = planToRecipe(
      plan({
        filterGroups: [
          { conditions: [condition({ column: 'XXX' }), condition({ value: null })] },
          { conditions: [] },
        ],
        steps: [
          { kind: 'sort', columns: ['YYY'], keep: null, direction: 'desc', value: null },
          { kind: 'select_columns', columns: [], keep: null, direction: null, value: null },
        ],
        metrics: [{ operation: 'avg', column: 'ZZZ', label: 'Media' }],
      }),
      COLUMNS,
    );

    assert.equal(recipeSchema.safeParse(recipe).success, true);
    assert.ok(warnings.length >= 4, 'cada descarte precisa gerar um aviso');
  });
});
