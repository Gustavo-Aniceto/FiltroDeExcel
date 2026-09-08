import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Sparkles, X } from 'lucide-react';
import type { Recipe } from '@excelflow/contracts';
import { STEP_LABELS, METRIC_LABELS, OPERATOR_LABELS } from '@excelflow/contracts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api-client';

interface InterpretResult {
  recipe: Recipe;
  explanation: string;
  warnings: string[];
  unsupported: string[];
}

/**
 * Assistente de linguagem natural.
 *
 * A regra que define esta tela: o assistente PROPOE, o usuario APLICA. O
 * resultado nunca entra em vigor sozinho -- ele aparece traduzido em portugues,
 * com o que ficou de fora, e so vale depois de "Aplicar".
 *
 * Isso nao e cerimonia: um filtro errado aplicado em silencio produz um numero
 * plausivel e errado, que a pessoa leva para uma reuniao. Ver o que sera feito
 * antes de aplicar e o que torna o recurso confiavel.
 */
export function AssistantBar({
  datasetId,
  onApply,
}: {
  datasetId: string;
  onApply: (recipe: Recipe) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<InterpretResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<{ enabled: boolean }>('/ai/status'),
    // A configuracao do assistente nao muda durante a sessao.
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: (text: string) =>
      api.post<InterpretResult>(`/ai/datasets/${datasetId}/interpret`, { prompt: text }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (caught) => {
      setResult(null);
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel interpretar o pedido.');
    },
  });

  // Sem chave configurada o campo simplesmente nao aparece. Melhor do que
  // oferecer algo que devolve erro ao ser usado.
  if (!status?.enabled) return null;

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim().length >= 3) mutation.mutate(prompt.trim());
        }}
        className="flex items-center gap-2"
      >
        <Sparkles className="ml-1 size-4 shrink-0 text-brand" aria-hidden="true" />
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Descreva o que voce quer. Ex.: aprovados acima de 500 reais, sem duplicados"
          aria-label="Descreva o que voce quer"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-content outline-none placeholder:text-content-subtle"
        />
        <Button
          type="submit"
          size="sm"
          loading={mutation.isPending}
          disabled={prompt.trim().length < 3}
        >
          Interpretar
        </Button>
      </form>

      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}

      {result && (
        <div className="mt-3 space-y-3 rounded-md border border-brand/20 bg-brand-subtle p-3">
          <p className="text-sm text-content">{result.explanation}</p>

          <RecipePreview recipe={result.recipe} />

          {result.unsupported.length > 0 && (
            <div className="flex items-start gap-2 text-sm text-content-muted">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="font-medium text-content">Nao consegui traduzir:</p>
                <ul className="mt-0.5 list-inside list-disc">
                  {result.unsupported.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {result.warnings.map((warning, index) => (
            <p key={index} className="flex items-start gap-2 text-sm text-content-muted">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              {warning}
            </p>
          ))}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onApply(result.recipe);
                setResult(null);
                setPrompt('');
              }}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Aplicar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
              <X className="size-3.5" aria-hidden="true" />
              Descartar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Traduz a Receita proposta de volta para portugues.
 *
 * Mostrar o JSON aqui seria inutil para quem o sistema atende. A pessoa precisa
 * ler "Status igual a APROVADO" e reconhecer -- ou nao reconhecer -- o proprio
 * pedido.
 */
function RecipePreview({ recipe }: { recipe: Recipe }) {
  const lines: string[] = [];

  for (const step of recipe.steps) {
    if (step.kind === 'filter') {
      describeFilter(step.filter, lines);
    } else {
      lines.push(STEP_LABELS[step.kind]);
    }
  }

  for (const metric of recipe.metrics) {
    lines.push(
      metric.column
        ? `${METRIC_LABELS[metric.operation]} de ${metric.column}`
        : METRIC_LABELS[metric.operation],
    );
  }

  if (lines.length === 0) {
    return <p className="text-sm text-content-muted">Nenhuma regra foi identificada no pedido.</p>;
  }

  return (
    <ul className="space-y-1 text-sm text-content-muted">
      {lines.map((line, index) => (
        <li key={index} className="flex gap-1.5">
          <span aria-hidden="true">·</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function describeFilter(node: unknown, lines: string[], depth = 0): void {
  const filter = node as {
    type: string;
    logic?: string;
    children?: unknown[];
    column?: string;
    operator?: keyof typeof OPERATOR_LABELS;
    value?: unknown;
    values?: unknown[];
    range?: unknown[];
  };

  if (filter.type === 'condition') {
    const detail =
      filter.values !== undefined
        ? filter.values.join(', ')
        : filter.range !== undefined
          ? `${filter.range[0]} e ${filter.range[1]}`
          : (filter.value ?? '');
    const operator = filter.operator ? OPERATOR_LABELS[filter.operator] : '';
    lines.push(`${'  '.repeat(depth)}${filter.column} ${operator} ${detail}`.trimEnd());
    return;
  }

  const children = filter.children ?? [];
  const connector = filter.logic === 'OR' ? 'Qualquer um destes:' : 'Todos estes:';
  if (children.length > 1) lines.push(`${'  '.repeat(depth)}${connector}`);

  for (const child of children) {
    describeFilter(child, lines, children.length > 1 ? depth + 1 : depth);
  }
}
