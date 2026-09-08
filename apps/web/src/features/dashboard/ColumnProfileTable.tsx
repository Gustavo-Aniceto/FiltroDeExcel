import type { ColumnProfile, ColumnType } from '@excelflow/contracts';
import { Calendar, CircleSlash, DollarSign, Hash, ToggleLeft, Type } from 'lucide-react';
import { cn, formatCategoryValue, formatCurrency, formatInteger, formatNumber } from '@/lib/utils';

const TYPE_META: Record<ColumnType, { label: string; icon: typeof Type; className: string }> = {
  text: { label: 'Texto', icon: Type, className: 'bg-surface-sunken text-content-muted' },
  number: { label: 'Numero', icon: Hash, className: 'bg-brand-subtle text-brand' },
  currency: { label: 'Moeda', icon: DollarSign, className: 'bg-success-subtle text-success' },
  date: { label: 'Data', icon: Calendar, className: 'bg-warning-subtle text-warning' },
  boolean: { label: 'Sim/Nao', icon: ToggleLeft, className: 'bg-surface-sunken text-content-muted' },
  empty: { label: 'Vazia', icon: CircleSlash, className: 'bg-surface-sunken text-content-subtle' },
};

export function ColumnTypeBadge({ type }: { type: ColumnType }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
        meta.className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** Resumo textual de uma coluna, adequado ao tipo dela. */
function summarize(column: ColumnProfile): string {
  if (column.type === 'currency' && column.sum != null) {
    return `Soma ${formatCurrency(column.sum)} · media ${formatCurrency(column.avg)}`;
  }
  if (column.type === 'number' && column.min != null) {
    return `${formatNumber(column.min)} a ${formatNumber(column.max)}`;
  }
  if (column.type === 'date' && column.minDate) {
    const inicio = new Date(column.minDate).toLocaleDateString('pt-BR');
    const fim = column.maxDate ? new Date(column.maxDate).toLocaleDateString('pt-BR') : '';
    return `${inicio} a ${fim}`;
  }
  if (column.topValues?.length) {
    return column.topValues
      .slice(0, 3)
      .map((v) => formatCategoryValue(v.value, column.type))
      .join(', ');
  }
  return '--';
}

/**
 * Tabela do perfil das colunas.
 *
 * Cumpre tambem o papel de "view em tabela" exigida por acessibilidade: tudo o
 * que os cartoes e as barras mostram graficamente esta aqui em texto, legivel
 * por leitor de tela e copiavel.
 */
export function ColumnProfileTable({
  columns,
  rowCount,
}: {
  columns: ColumnProfile[];
  rowCount: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="px-5 py-2.5 font-medium text-content-muted">Coluna</th>
            <th scope="col" className="px-3 py-2.5 font-medium text-content-muted">Tipo</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium text-content-muted">Vazios</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium text-content-muted">Unicos</th>
            <th scope="col" className="px-5 py-2.5 font-medium text-content-muted">Resumo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {columns.map((column) => {
            const emptyPercent = rowCount > 0 ? (column.nullCount / rowCount) * 100 : 0;
            return (
              <tr key={column.name} className="hover:bg-surface-muted">
                <th scope="row" className="max-w-[220px] truncate px-5 py-2.5 text-left font-medium text-content">
                  {column.name}
                </th>
                <td className="px-3 py-2.5">
                  <ColumnTypeBadge type={column.type} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span className={emptyPercent > 20 ? 'text-warning' : 'text-content-muted'}>
                    {formatInteger(column.nullCount)}
                  </span>
                  {column.nullCount > 0 && (
                    <span className="ml-1 text-xs text-content-subtle">
                      {emptyPercent.toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-content-muted">
                  {formatInteger(column.distinctCount)}
                </td>
                <td className="max-w-[320px] truncate px-5 py-2.5 text-content-muted">
                  {summarize(column)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
