import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ColumnProfile } from '@excelflow/contracts';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { cn, formatInteger } from '@/lib/utils';

interface DataGridProps {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  profile: ColumnProfile[];
  page: number;
  pageSize: number;
  totalRows: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [25, 50, 100, 200];

/**
 * Grade de dados.
 *
 * PAGINACAO NO SERVIDOR, e nao virtualizacao no cliente. A distincao importa: a
 * virtualizacao evita renderizar 100 mil linhas no DOM, mas o navegador ainda
 * teria de BAIXAR e guardar as 100 mil na memoria. Paginando no servidor, o
 * navegador nunca recebe mais do que uma pagina -- e navegar em 500 mil linhas
 * custa o mesmo que navegar em 500.
 *
 * Com no maximo 200 linhas por pagina, o DOM nunca fica grande o bastante para
 * justificar um virtualizador; ele so acrescentaria dependencia e complexidade
 * sem ganho mensuravel.
 */
export function DataGrid({
  columns,
  rows,
  profile,
  page,
  pageSize,
  totalRows,
  loading,
  onPageChange,
  onPageSizeChange,
}: DataGridProps) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  const typeOf = (name: string) => profile.find((c) => c.name === name)?.type;

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="relative overflow-auto" style={{ maxHeight: '58vh' }}>
        {loading && (
          <div className="absolute inset-0 z-20 flex items-start justify-center bg-surface/60 pt-16">
            <Spinner label="Aplicando regras" />
          </div>
        )}

        <table className="w-full border-collapse text-sm">
          {/* Cabecalho fixo: rolar 200 linhas sem ver o nome da coluna torna a
              tabela inutil justamente quando ha muitas colunas. */}
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((name) => (
                <th
                  key={name}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap border-b border-line bg-surface-muted px-3 py-2 text-left',
                    'font-medium text-content-muted',
                    isNumeric(typeOf(name)) && 'text-right',
                  )}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="px-3 py-12 text-center text-sm text-content-subtle"
                >
                  Nenhum registro atende as regras definidas.
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-line last:border-0 hover:bg-surface-muted">
                {columns.map((name) => {
                  const value = row[name];
                  const numeric = isNumeric(typeOf(name));
                  const empty = value === null || value === undefined;
                  return (
                    <td
                      key={name}
                      className={cn(
                        'max-w-[280px] truncate px-3 py-1.5',
                        numeric ? 'text-right tabular-nums' : 'text-left',
                        empty ? 'text-content-subtle' : 'text-content',
                      )}
                      title={empty ? '' : String(value)}
                    >
                      {formatCell(value, typeOf(name))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
        <p className="text-xs text-content-muted">
          {totalRows === 0
            ? 'Nenhum registro'
            : `${formatInteger(from)}–${formatInteger(to)} de ${formatInteger(totalRows)}`}
        </p>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-content-muted">
            Linhas
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Pagina anterior"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <span className="min-w-[72px] text-center text-xs tabular-nums text-content-muted">
              {formatInteger(page)} / {formatInteger(totalPages)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Proxima pagina"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function isNumeric(type: string | undefined): boolean {
  return type === 'number' || type === 'currency';
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR');
const numberFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCell(value: unknown, type: string | undefined): string {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao';

  if (type === 'date' && typeof value === 'string') {
    const date = new Date(value);
    // Uma data invalida deve aparecer como veio, e nao como "Invalid Date".
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
  }

  if (isNumeric(type) && typeof value === 'number') {
    return numberFormatter.format(value);
  }

  return String(value);
}
