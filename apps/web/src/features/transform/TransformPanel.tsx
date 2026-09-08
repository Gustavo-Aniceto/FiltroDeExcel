import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ColumnProfile, RecipeStep, RecipeStepKind } from '@excelflow/contracts';
import { STEP_LABELS } from '@excelflow/contracts';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { nextId } from '../filters/filter-tree';
import { cn } from '@/lib/utils';

/** Passos oferecidos aqui. O filtro tem painel proprio e nao aparece na lista. */
const AVAILABLE: RecipeStepKind[] = [
  'drop_duplicates',
  'drop_empty_rows',
  'select_columns',
  'drop_columns',
  'rename_columns',
  'sort',
  'fill_empty',
  'replace_values',
];

interface TransformPanelProps {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  columns: ColumnProfile[];
  /** Colunas do RESULTADO atual: refletem select/rename ja aplicados. */
  resultColumns: string[];
}

/**
 * Painel de tratamento dos dados.
 *
 * A ORDEM dos passos importa e fica visivel: numerados, com setas para mover.
 * "Remover duplicados" antes ou depois de "filtrar" produz resultados
 * diferentes, e esconder isso do usuario geraria numeros que ele nao conseguiria
 * explicar.
 */
export function TransformPanel({ steps, onChange, columns, resultColumns }: TransformPanelProps) {
  function add(kind: RecipeStepKind) {
    onChange([...steps, defaultStep(kind, columns)]);
  }

  function update(index: number, step: RecipeStep) {
    const next = [...steps];
    next[index] = step;
    onChange(next);
  }

  function remove(index: number) {
    onChange(steps.filter((_, i) => i !== index));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {steps.length === 0 && (
        <p className="text-sm text-content-subtle">
          Nenhum tratamento. Os dados sairao como estao na planilha.
        </p>
      )}

      {steps.map((step, index) => (
        <div key={step.id ?? index} className="rounded-md border border-line bg-surface p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-surface-sunken text-xs font-medium text-content-muted">
              {index + 1}
            </span>
            <span className="flex-1 text-sm font-medium text-content">
              {STEP_LABELS[step.kind]}
            </span>
            <Button variant="ghost" size="sm" aria-label="Mover para cima"
                    disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp className="size-3.5" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Mover para baixo"
                    disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown className="size-3.5" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Remover passo" onClick={() => remove(index)}>
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <StepEditor
            step={step}
            onChange={(next) => update(index, next)}
            columns={columns}
            resultColumns={resultColumns}
          />
        </div>
      ))}

      <Select
        aria-label="Adicionar tratamento"
        value=""
        onChange={(e) => {
          if (e.target.value) add(e.target.value as RecipeStepKind);
          e.target.value = '';
        }}
      >
        <option value="">+ Adicionar tratamento...</option>
        {AVAILABLE.map((kind) => (
          <option key={kind} value={kind}>{STEP_LABELS[kind]}</option>
        ))}
      </Select>
    </div>
  );
}

function defaultStep(kind: RecipeStepKind, columns: ColumnProfile[]): RecipeStep {
  const id = nextId();
  const first = columns[0]?.name ?? '';

  switch (kind) {
    case 'drop_duplicates':
      // Sem colunas escolhidas significa "linha inteira duplicada" -- o padrao
      // que o usuario espera de "remover duplicados".
      return { id, kind, columns: [], keep: 'first' };
    case 'drop_empty_rows':
      return { id, kind, columns: [], mode: 'all' };
    case 'select_columns':
      return { id, kind, columns: columns.map((c) => c.name) };
    case 'drop_columns':
      return { id, kind, columns: [first] };
    case 'rename_columns':
      return { id, kind, mapping: [{ from: first, to: first }] };
    case 'sort':
      return { id, kind, by: [{ column: first, direction: 'asc' }] };
    case 'fill_empty':
      return { id, kind, column: first, value: '' };
    case 'replace_values':
      return { id, kind, column: first, mode: 'exact', replacements: [{ from: '', to: '' }] };
    default:
      return { id, kind: 'sort', by: [{ column: first, direction: 'asc' }] };
  }
}

function StepEditor({
  step,
  onChange,
  columns,
  resultColumns,
}: {
  step: RecipeStep;
  onChange: (next: RecipeStep) => void;
  columns: ColumnProfile[];
  resultColumns: string[];
}) {
  // Passos que rodam DEPOIS de um rename precisam ver o nome novo. Usamos as
  // colunas do resultado quando existem, caindo para as originais no comeco.
  const names = resultColumns.length > 0 ? resultColumns : columns.map((c) => c.name);

  switch (step.kind) {
    case 'drop_duplicates':
      return (
        <div className="space-y-2">
          <ColumnCheckboxes
            names={names}
            selected={step.columns}
            onChange={(next) => onChange({ ...step, columns: next })}
            emptyHint="Nenhuma marcada = compara a linha inteira"
          />
          <Select
            label="O que manter"
            value={step.keep}
            onChange={(e) => onChange({ ...step, keep: e.target.value as 'first' | 'last' | 'none' })}
          >
            <option value="first">A primeira ocorrencia</option>
            <option value="last">A ultima ocorrencia</option>
            <option value="none">Nenhuma (remove todas as repetidas)</option>
          </Select>
        </div>
      );

    case 'drop_empty_rows':
      return (
        <div className="space-y-2">
          <ColumnCheckboxes
            names={names}
            selected={step.columns}
            onChange={(next) => onChange({ ...step, columns: next })}
            emptyHint="Nenhuma marcada = considera todas as colunas"
          />
          <Select
            label="Remover quando"
            value={step.mode}
            onChange={(e) => onChange({ ...step, mode: e.target.value as 'all' | 'any' })}
          >
            <option value="all">Todas as colunas estiverem vazias</option>
            <option value="any">Qualquer coluna estiver vazia</option>
          </Select>
        </div>
      );

    case 'select_columns':
    case 'drop_columns':
      return (
        <ColumnCheckboxes
          names={names}
          selected={step.columns}
          onChange={(next) => onChange({ ...step, columns: next } as RecipeStep)}
        />
      );

    case 'rename_columns':
      return (
        <div className="space-y-2">
          {step.mapping.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                aria-label="Coluna"
                value={entry.from}
                onChange={(e) => {
                  const mapping = [...step.mapping];
                  mapping[index] = { ...entry, from: e.target.value };
                  onChange({ ...step, mapping });
                }}
              >
                {names.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
              <span className="shrink-0 text-xs text-content-subtle">para</span>
              <Input
                aria-label="Novo nome"
                value={entry.to}
                onChange={(e) => {
                  const mapping = [...step.mapping];
                  mapping[index] = { ...entry, to: e.target.value };
                  onChange({ ...step, mapping });
                }}
              />
              <Button variant="ghost" size="sm" aria-label="Remover"
                      onClick={() => onChange({ ...step, mapping: step.mapping.filter((_, i) => i !== index) })}>
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm"
                  onClick={() => onChange({ ...step, mapping: [...step.mapping, { from: names[0] ?? '', to: '' }] })}>
            <Plus className="size-3.5" aria-hidden="true" /> Renomear outra
          </Button>
        </div>
      );

    case 'sort':
      return (
        <div className="space-y-2">
          {step.by.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                aria-label="Coluna"
                value={entry.column}
                onChange={(e) => {
                  const by = [...step.by];
                  by[index] = { ...entry, column: e.target.value };
                  onChange({ ...step, by });
                }}
              >
                {names.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
              <Select
                aria-label="Ordem"
                className="max-w-[140px]"
                value={entry.direction}
                onChange={(e) => {
                  const by = [...step.by];
                  by[index] = { ...entry, direction: e.target.value as 'asc' | 'desc' };
                  onChange({ ...step, by });
                }}
              >
                <option value="asc">Crescente</option>
                <option value="desc">Decrescente</option>
              </Select>
              {step.by.length > 1 && (
                <Button variant="ghost" size="sm" aria-label="Remover"
                        onClick={() => onChange({ ...step, by: step.by.filter((_, i) => i !== index) })}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm"
                  onClick={() => onChange({ ...step, by: [...step.by, { column: names[0] ?? '', direction: 'asc' }] })}>
            <Plus className="size-3.5" aria-hidden="true" /> Ordenar tambem por
          </Button>
        </div>
      );

    case 'fill_empty':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select label="Coluna" value={step.column}
                  onChange={(e) => onChange({ ...step, column: e.target.value })}>
            {names.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
          <Input label="Preencher com" value={String(step.value ?? '')}
                 onChange={(e) => onChange({ ...step, value: e.target.value })} />
        </div>
      );

    case 'replace_values':
      return (
        <div className="space-y-2">
          <Select label="Coluna" value={step.column}
                  onChange={(e) => onChange({ ...step, column: e.target.value })}>
            {names.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
          {step.replacements.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input aria-label="De" placeholder="valor atual" value={entry.from}
                     onChange={(e) => {
                       const replacements = [...step.replacements];
                       replacements[index] = { ...entry, from: e.target.value };
                       onChange({ ...step, replacements });
                     }} />
              <span className="shrink-0 text-xs text-content-subtle">por</span>
              <Input aria-label="Para" placeholder="novo valor" value={entry.to}
                     onChange={(e) => {
                       const replacements = [...step.replacements];
                       replacements[index] = { ...entry, to: e.target.value };
                       onChange({ ...step, replacements });
                     }} />
              {step.replacements.length > 1 && (
                <Button variant="ghost" size="sm" aria-label="Remover"
                        onClick={() => onChange({ ...step, replacements: step.replacements.filter((_, i) => i !== index) })}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm"
                  onClick={() => onChange({ ...step, replacements: [...step.replacements, { from: '', to: '' }] })}>
            <Plus className="size-3.5" aria-hidden="true" /> Substituir outro
          </Button>
        </div>
      );

    default:
      return null;
  }
}

function ColumnCheckboxes({
  names,
  selected,
  onChange,
  emptyHint,
}: {
  names: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyHint?: string;
}) {
  const set = new Set(selected);
  return (
    <div>
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-line bg-surface-muted p-2">
        {names.map((name) => {
          const checked = set.has(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() =>
                onChange(checked ? selected.filter((item) => item !== name) : [...selected, name])
              }
              aria-pressed={checked}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                checked
                  ? 'border-brand bg-brand text-white'
                  : 'border-line-strong bg-surface text-content-muted hover:bg-surface-sunken',
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
      {emptyHint && selected.length === 0 && (
        <p className="mt-1 text-xs text-content-subtle">{emptyHint}</p>
      )}
    </div>
  );
}
