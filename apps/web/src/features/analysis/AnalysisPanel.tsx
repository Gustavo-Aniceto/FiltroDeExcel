import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import type { ColumnProfile, Metric, MetricOperation, MetricResult } from '@excelflow/contracts';
import { COLUMNLESS_OPERATIONS, METRIC_LABELS, METRIC_OPERATIONS } from '@excelflow/contracts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { nextId } from '../filters/filter-tree';
import { formatCurrency, formatInteger, formatNumber } from '@/lib/utils';

/** Operacoes que exigem coluna numerica. */
const NUMERIC_ONLY: MetricOperation[] = ['sum', 'avg', 'min', 'max', 'median'];

interface AnalysisPanelProps {
  metrics: Metric[];
  onChange: (next: Metric[]) => void;
  columns: ColumnProfile[];
  resultColumns: string[];
}

export function AnalysisPanel({ metrics, onChange, columns, resultColumns }: AnalysisPanelProps) {
  // As analises rodam sobre o RESULTADO da receita. Se um passo renomeou ou
  // removeu colunas, oferecer os nomes originais criaria analises que falham
  // exatamente quando o usuario mais precisa do numero.
  const available: Array<{ name: string; type: ColumnProfile['type'] }> =
    resultColumns.length > 0
      ? resultColumns.map(
          (name) => columns.find((c) => c.name === name) ?? { name, type: 'text' as const },
        )
      : columns;

  function update(index: number, metric: Metric) {
    const next = [...metrics];
    next[index] = metric;
    onChange(next);
  }

  return (
    <div className="space-y-2.5">
      {metrics.length === 0 && (
        <p className="text-sm text-content-subtle">
          Nenhuma analise. Adicione somas, medias e contagens sobre o resultado.
        </p>
      )}

      {metrics.map((metric, index) => {
        const needsColumn = !COLUMNLESS_OPERATIONS.includes(metric.operation);
        const numericOnly = NUMERIC_ONLY.includes(metric.operation);
        const options = numericOnly
          ? available.filter((c) => c.type === 'number' || c.type === 'currency')
          : available;

        return (
          <div key={metric.id} className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Select
                aria-label="Operacao"
                value={metric.operation}
                onChange={(e) => {
                  const operation = e.target.value as MetricOperation;
                  const nowNumeric = NUMERIC_ONLY.includes(operation);

                  // As opcoes validas dependem da operacao NOVA, nao da atual.
                  // Usar a lista da operacao anterior (que em "contagem" inclui
                  // colunas de texto) faria "Soma" cair numa coluna de texto e
                  // a analise nascer quebrada.
                  const validColumns = nowNumeric
                    ? available.filter((c) => c.type === 'number' || c.type === 'currency')
                    : available;

                  const keepsColumn = validColumns.some((c) => c.name === metric.column);
                  const column = keepsColumn ? metric.column : validColumns[0]?.name;

                  update(index, {
                    ...metric,
                    operation,
                    column: COLUMNLESS_OPERATIONS.includes(operation) ? undefined : column,
                    format: guessFormat(operation, available.find((c) => c.name === column)),
                  });
                }}
              >
                {METRIC_OPERATIONS.map((operation) => (
                  <option key={operation} value={operation}>
                    {METRIC_LABELS[operation]}
                  </option>
                ))}
              </Select>

              {needsColumn ? (
                <Select
                  aria-label="Coluna"
                  value={metric.column ?? ''}
                  onChange={(e) => {
                    const column = e.target.value;
                    update(index, {
                      ...metric,
                      column,
                      format: guessFormat(metric.operation, available.find((c) => c.name === column)),
                    });
                  }}
                >
                  {options.length === 0 && <option value="">Nenhuma coluna numerica</option>}
                  {options.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <div />
              )}

              <Input
                aria-label="Nome da analise"
                placeholder="Nome (opcional)"
                value={metric.label ?? ''}
                onChange={(e) => update(index, { ...metric, label: e.target.value || undefined })}
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              aria-label="Remover analise"
              className="mt-0.5"
              onClick={() => onChange(metrics.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        );
      })}

      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...metrics, { id: nextId(), operation: 'count', format: 'integer' }])}
      >
        <Plus className="size-3.5" aria-hidden="true" /> Adicionar analise
      </Button>
    </div>
  );
}

function guessFormat(
  operation: MetricOperation,
  column: { type?: string } | undefined,
): Metric['format'] {
  if (operation === 'percentage') return 'percent';
  if (['count', 'count_distinct', 'count_empty'].includes(operation)) return 'integer';
  return column?.type === 'currency' ? 'currency' : 'number';
}

/** Cartoes com o resultado das analises. */
export function MetricCards({
  metrics,
}: {
  metrics: Array<MetricResult & { error?: string | null }>;
}) {
  if (metrics.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
      {metrics.map((metric) => (
        <div key={metric.id} className="rounded-card border border-line bg-surface px-3.5 py-3">
          <p
            className="truncate text-xs font-medium uppercase tracking-wide text-content-subtle"
            title={metric.label}
          >
            {metric.label}
          </p>
          {metric.error ? (
            // A analise que falhou mostra o motivo no lugar do numero. Sumir da
            // tela faria o usuario achar que ela nunca existiu.
            <p className="mt-1 flex items-start gap-1 text-xs text-danger" title={metric.error}>
              <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span className="line-clamp-2">{metric.error}</span>
            </p>
          ) : (
            <p
              className="mt-1 truncate text-xl font-semibold tracking-tight text-content"
              title={formatMetric(metric)}
            >
              {formatMetric(metric)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function formatMetric(metric: MetricResult): string {
  if (metric.value === null) return '--';
  if (metric.format === 'currency') return formatCurrency(metric.value);
  if (metric.format === 'percent') return `${formatNumber(metric.value)}%`;
  if (metric.format === 'integer') return formatInteger(metric.value);
  return formatNumber(metric.value);
}
