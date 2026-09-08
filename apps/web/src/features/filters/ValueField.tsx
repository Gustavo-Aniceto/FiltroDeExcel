import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ColumnProfile, FilterCondition } from '@excelflow/contracts';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api-client';
import { cn, formatInteger } from '@/lib/utils';

interface ValueFieldProps {
  condition: FilterCondition;
  column: ColumnProfile | undefined;
  datasetId: string;
  onChange: (next: FilterCondition) => void;
}

const RANGE_OPERATORS = ['between', 'date_between'];
const LIST_OPERATORS = ['in', 'not_in'];

/**
 * Campo de valor da condicao, adequado ao operador e ao tipo da coluna.
 *
 * Para colunas categoricas oferecemos os valores EXISTENTES numa lista. Digitar
 * o valor a mao e a principal causa de "o filtro nao retornou nada": basta um
 * acento, um espaco a mais ou a caixa diferente. Escolher de uma lista elimina
 * a classe inteira de erro.
 */
export function ValueField({ condition, column, datasetId, onChange }: ValueFieldProps) {
  const operator = condition.operator;

  if (RANGE_OPERATORS.includes(operator)) {
    const [start, end] = 'range' in condition ? condition.range : ['', ''];
    const type = operator === 'date_between' ? 'date' : 'number';
    return (
      <div className="flex items-center gap-1.5">
        <Input
          type={type}
          aria-label="De"
          value={(start as string) ?? ''}
          onChange={(e) =>
            onChange({ ...condition, range: [e.target.value, end] } as FilterCondition)
          }
        />
        <span className="shrink-0 text-xs text-content-subtle">ate</span>
        <Input
          type={type}
          aria-label="Ate"
          value={(end as string) ?? ''}
          onChange={(e) =>
            onChange({ ...condition, range: [start, e.target.value] } as FilterCondition)
          }
        />
      </div>
    );
  }

  if (LIST_OPERATORS.includes(operator)) {
    const values = ('values' in condition ? condition.values : []) as string[];
    return (
      <MultiValuePicker
        datasetId={datasetId}
        column={condition.column}
        selected={values}
        onChange={(next) => onChange({ ...condition, values: next } as FilterCondition)}
      />
    );
  }

  const value = ('value' in condition ? condition.value : '') as string;

  if (column?.type === 'date') {
    return (
      <Input
        type="date"
        aria-label="Valor"
        value={value ?? ''}
        onChange={(e) => onChange({ ...condition, value: e.target.value } as FilterCondition)}
      />
    );
  }

  const isNumeric = column?.type === 'number' || column?.type === 'currency';
  const isEqualityOnText =
    column && ['text', 'boolean'].includes(column.type) && ['equals', 'not_equals'].includes(operator);

  // Igualdade sobre coluna categorica: lista de valores em vez de campo livre.
  if (isEqualityOnText && (column?.topValues?.length ?? 0) > 0) {
    return (
      <SingleValuePicker
        datasetId={datasetId}
        column={condition.column}
        value={value ?? ''}
        onChange={(next) => onChange({ ...condition, value: next } as FilterCondition)}
      />
    );
  }

  return (
    <Input
      // `inputMode="decimal"` abre o teclado numerico no celular sem impedir
      // que o usuario digite "1.234,56" -- que o backend converte.
      inputMode={isNumeric ? 'decimal' : undefined}
      aria-label="Valor"
      placeholder={isNumeric ? '0,00' : 'Digite o valor'}
      value={value ?? ''}
      onChange={(e) => onChange({ ...condition, value: e.target.value } as FilterCondition)}
    />
  );
}

function useColumnValues(datasetId: string, column: string, search: string, enabled: boolean) {
  return useQuery({
    queryKey: ['column-values', datasetId, column, search],
    queryFn: () =>
      api.post<{ values: Array<{ value: string; count: number }> }>(
        `/datasets/${datasetId}/column-values`,
        { column, search: search || null },
      ),
    enabled,
    // Os valores distintos de uma coluna nao mudam: o dataset e imutavel apos a
    // ingestao. Cache longo evita reconsultar a cada abertura da lista.
    staleTime: 10 * 60 * 1000,
  });
}

function SingleValuePicker({
  datasetId,
  column,
  value,
  onChange,
}: {
  datasetId: string;
  column: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useColumnValues(datasetId, column, search, open);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-left text-sm"
      >
        <span className={cn('truncate', !value && 'text-content-subtle')}>
          {value || 'Escolher valor'}
        </span>
        <ChevronDown className="size-4 shrink-0 text-content-subtle" aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Camada invisivel que fecha ao clicar fora. Mais simples e mais
              confiavel do que ouvir cliques no documento inteiro. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute z-20 mt-1 w-full min-w-[240px] rounded-md border border-line bg-surface shadow-lg">
            <div className="border-b border-line p-2">
              <Input
                autoFocus
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {isLoading && <li className="px-3 py-2 text-sm text-content-subtle">Carregando...</li>}
              {data?.values.length === 0 && (
                <li className="px-3 py-2 text-sm text-content-subtle">Nenhum valor encontrado.</li>
              )}
              {data?.values.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      setSearch('');
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                  >
                    <span className="truncate">{option.value}</span>
                    <span className="shrink-0 text-xs tabular-nums text-content-subtle">
                      {formatInteger(option.count)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function MultiValuePicker({
  datasetId,
  column,
  selected,
  onChange,
}: {
  datasetId: string;
  column: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useColumnValues(datasetId, column, search, open);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(candidate: string) {
    onChange(
      selectedSet.has(candidate)
        ? selected.filter((item) => item !== candidate)
        : [...selected, candidate],
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-left text-sm"
      >
        <span className={cn('truncate', selected.length === 0 && 'text-content-subtle')}>
          {selected.length === 0
            ? 'Escolher valores'
            : selected.length <= 2
              ? selected.join(', ')
              : `${selected.length} valores selecionados`}
        </span>
        <ChevronDown className="size-4 shrink-0 text-content-subtle" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute z-20 mt-1 w-full min-w-[240px] rounded-md border border-line bg-surface shadow-lg">
            <div className="border-b border-line p-2">
              <Input
                autoFocus
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {isLoading && <li className="px-3 py-2 text-sm text-content-subtle">Carregando...</li>}
              {data?.values.map((option) => {
                const checked = selectedSet.has(option.value);
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      onClick={() => toggle(option.value)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          checked ? 'border-brand bg-brand text-white' : 'border-line-strong',
                        )}
                        aria-hidden="true"
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{option.value}</span>
                      <span className="shrink-0 text-xs tabular-nums text-content-subtle">
                        {formatInteger(option.count)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selected.length > 0 && (
              <div className="border-t border-line px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-xs text-content-muted hover:text-content"
                >
                  Limpar selecao
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
