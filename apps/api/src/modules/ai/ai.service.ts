import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  FILTER_OPERATORS,
  METRIC_OPERATIONS,
  OPERATOR_LABELS,
  recipeSchema,
  type ColumnProfile,
  type Recipe,
} from '@excelflow/contracts';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { writeAuditLog } from '../auth/auth.repository.js';
import { loadDatasetContext } from '../datasets/dataset-context.js';
import { aiPlanSchema, planToRecipe } from './ai.schema.js';

/**
 * ============================================================================
 * ASSISTENTE: linguagem natural -> Receita estruturada
 * ============================================================================
 * A GARANTIA CENTRAL, e a razao de esta fase ser segura:
 *
 *   O modelo NAO executa nada. Ele produz um documento de dados, que passa
 *   pela mesma validacao da interface visual e e compilado pelo mesmo
 *   compilador parametrizado. Nao ha caminho por onde a saida do modelo vire
 *   SQL, comando ou codigo.
 *
 * E mais: o resultado e apresentado ao usuario para CONFERENCIA antes de valer.
 * O assistente escreve o rascunho; quem aplica e a pessoa.
 * ============================================================================
 */

let client: Anthropic | null = null;

export function isAiEnabled(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!isAiEnabled()) {
    throw AppError.validation(
      'O assistente nao esta configurado. Defina ANTHROPIC_API_KEY no arquivo .env para ativa-lo.',
    );
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Instrucoes ESTAVEIS do assistente.
 *
 * Ficam separadas do contexto da planilha de proposito: sao identicas em toda
 * requisicao, o que permite marca-las para cache. O trecho variavel (colunas do
 * dataset e pedido do usuario) vai depois, na mensagem.
 */
const SYSTEM_PROMPT = `Voce traduz pedidos em portugues sobre planilhas para uma estrutura de filtros e analises.

O usuario trabalha com planilhas de operacoes financeiras e nao sabe programar. Ele descreve o que quer em linguagem comum, e voce produz a estrutura correspondente.

REGRAS

1. Use APENAS colunas da lista fornecida, copiando o nome exatamente como aparece. Nunca invente uma coluna.
2. Se o pedido mencionar algo que nao existe na planilha, ou que voce nao consegue expressar, liste em "unsupported" em vez de aproximar. Uma aproximacao silenciosa produz um numero errado que o usuario vai usar achando que esta certo.
3. Valores monetarios: escreva apenas o numero, sem "R$" e sem separador de milhar. "500 reais" vira "500". "mil e quinhentos" vira "1500".
4. Datas: use o formato AAAA-MM-DD. "setembro de 2026" vira o intervalo 2026-09-01 a 2026-09-30.
5. Para valores de texto, prefira os valores que aparecem na lista de exemplos de cada coluna, respeitando a grafia exata que consta la.
6. "acima de X" e maior que X (greater_than). "a partir de X" inclui X (greater_or_equal). Respeite a diferenca.
7. So adicione analises se o usuario pediu numeros (soma, total, media, quantos, percentual). Nao invente analises que ele nao pediu.
8. "explanation" deve ser uma frase curta em portugues descrevendo o que sera feito, para a pessoa conferir antes de aplicar.

OPERADORES DISPONIVEIS
${FILTER_OPERATORS.map((operator) => `- ${operator}: ${OPERATOR_LABELS[operator]}`).join('\n')}

ANALISES DISPONIVEIS
${METRIC_OPERATIONS.join(', ')}

Combine condicoes dentro de um grupo com E. Use mais de um grupo apenas quando o pedido tiver um OU explicito.`;

function describeColumns(columns: ColumnProfile[]): string {
  const TYPE_NAMES: Record<string, string> = {
    text: 'texto',
    number: 'numero',
    currency: 'valor monetario',
    date: 'data',
    boolean: 'sim/nao',
    empty: 'vazia',
  };

  return columns
    .map((column) => {
      const parts = [`- "${column.name}" (${TYPE_NAMES[column.type] ?? column.type})`];

      // Os valores existentes sao o que mais melhora a qualidade da traducao:
      // sem eles o modelo escreve "Aprovado" onde a planilha tem "APROVADO", e
      // o filtro devolve zero registros.
      if (column.topValues?.length) {
        const sample = column.topValues.slice(0, 8).map((v) => `"${v.value}"`).join(', ');
        parts.push(`  valores existentes: ${sample}`);
      } else if (column.type === 'currency' || column.type === 'number') {
        if (column.min !== null && column.max !== null) {
          parts.push(`  faixa: ${column.min} a ${column.max}`);
        }
      } else if (column.type === 'date' && column.minDate) {
        parts.push(`  periodo: ${column.minDate.slice(0, 10)} a ${column.maxDate?.slice(0, 10)}`);
      }

      return parts.join('\n');
    })
    .join('\n');
}

export interface InterpretResult {
  recipe: Recipe;
  explanation: string;
  warnings: string[];
  unsupported: string[];
}

export async function interpret(
  datasetId: string,
  prompt: string,
  context: { userId: string; ipAddress: string | null; userAgent: string | null },
): Promise<InterpretResult> {
  const dataset = await loadDatasetContext(datasetId, context.userId);
  const anthropic = getClient();

  let response;
  try {
    response = await anthropic.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 8000,
      // Traducao estruturada e tarefa de classificacao: esforco medio entrega a
      // mesma qualidade que alto, com menos espera. O usuario esta olhando a
      // tela enquanto isso roda.
      output_config: {
        effort: 'medium',
        format: zodOutputFormat(aiPlanSchema),
      },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // As instrucoes sao identicas em toda requisicao de todo usuario.
          // Cachea-las corta a maior parte do custo de entrada.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `COLUNAS DESTA PLANILHA (${dataset.rowCount} registros)

${describeColumns(dataset.columns)}

PEDIDO DO USUARIO

${prompt}`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw AppError.validation('A chave da API do assistente e invalida. Verifique ANTHROPIC_API_KEY.');
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw AppError.validation('O assistente esta sobrecarregado. Tente novamente em instantes.');
    }
    if (error instanceof Anthropic.APIError) {
      throw AppError.engine('O assistente nao esta disponivel no momento.');
    }
    throw error;
  }

  // Uma recusa por politica de seguranca chega como resposta 200. Checar
  // `stop_reason` antes de ler o conteudo evita tratar recusa como falha
  // generica -- e a mensagem para o usuario fica honesta.
  if (response.stop_reason === 'refusal') {
    throw AppError.validation(
      'O assistente nao pode processar este pedido. Reformule descrevendo apenas o filtro desejado.',
    );
  }

  const plan = response.parsed_output;
  if (!plan) {
    throw AppError.validation(
      'Nao consegui entender o pedido. Tente descrever de forma mais direta, por exemplo: '
        + '"aprovados acima de 500 reais".',
    );
  }

  const { recipe, warnings } = planToRecipe(plan, dataset.columns);

  // Validacao final com o MESMO schema da interface visual. Se o que saiu da
  // conversao nao for uma Receita valida, nao chega ao usuario -- e o problema
  // e nosso, nao dele.
  const validated = recipeSchema.safeParse(recipe);
  if (!validated.success) {
    throw AppError.validation(
      'Nao consegui montar um filtro valido a partir desse pedido. Tente ser mais especifico.',
    );
  }

  await writeAuditLog({
    userId: context.userId,
    action: 'ai.interpret',
    entityType: 'dataset',
    entityId: datasetId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    // Registramos a FORMA do resultado, nunca o texto do pedido nem conteudo da
    // planilha: o pedido pode citar dados internos da empresa.
    metadata: {
      steps: validated.data.steps.length,
      metrics: validated.data.metrics.length,
      warnings: warnings.length,
      unsupported: plan.unsupported.length,
    },
  });

  return {
    recipe: validated.data,
    explanation: plan.explanation,
    warnings,
    unsupported: plan.unsupported,
  };
}
