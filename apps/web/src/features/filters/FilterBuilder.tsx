import { Plus, Trash2 } from 'lucide-react';
import type { ColumnProfile, FilterGroup, FilterNode, LogicOperator } from '@excelflow/contracts';
import { emptyFilterGroup } from '@excelflow/contracts';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { ConditionRow } from './ConditionRow';
import { newCondition, replaceNode, removeNode } from './filter-tree';

interface FilterBuilderProps {
  value: FilterGroup;
  onChange: (next: FilterGroup) => void;
  columns: ColumnProfile[];
  datasetId: string;
  depth?: number;
}

/**
 * Construtor visual de filtros.
 *
 * O desafio de interface: expressar (A E B) OU (C E D) para alguem que nunca
 * programou. A solucao adotada e mostrar a estrutura FISICAMENTE -- grupos
 * aninhados aparecem indentados, dentro de uma moldura, com o conectivo (E/OU)
 * a esquerda ligando as linhas. E a mesma leitura visual de um parenteses, sem
 * exigir que o usuario saiba o que e um parenteses.
 *
 * O conectivo aparece UMA vez por grupo, e nao entre cada par de linhas: e uma
 * propriedade do grupo inteiro, e repeti-lo sugeriria que se pode misturar E e
 * OU no mesmo nivel -- o que produziria ambiguidade de precedencia.
 */
export function FilterBuilder({
  value,
  onChange,
  columns,
  datasetId,
  depth = 0,
}: FilterBuilderProps) {
  const children = value.children;

  function updateChild(index: number, next: FilterNode | null) {
    onChange(next === null ? removeNode(value, index) : replaceNode(value, index, next));
  }

  function addCondition() {
    const first = columns[0];
    if (!first) return;
    onChange({ ...value, children: [...children, newCondition(first)] });
  }

  function addGroup() {
    onChange({
      ...value,
      // Um subgrupo nasce com o conectivo OPOSTO ao do pai. Criar um grupo "E"
      // dentro de outro "E" nao muda nada -- o usuario adiciona o grupo
      // justamente porque quer alternar a logica.
      children: [...children, { ...emptyFilterGroup(), logic: value.logic === 'AND' ? 'OR' : 'AND' }],
    });
  }

  const nested = depth > 0;

  return (
    <div
      className={cn(
        nested && 'rounded-md border border-line bg-surface-muted p-3',
        'space-y-2',
      )}
    >
      {children.length === 0 && (
        <p className="py-1 text-sm text-content-subtle">
          Nenhuma condicao. Toda a planilha sera considerada.
        </p>
      )}

      {children.map((child, index) => (
        <div key={child.id ?? index} className="flex items-start gap-2">
          {/* Coluna do conectivo. A primeira linha nao tem conectivo -- ela nao
              liga nada a nada; as seguintes exibem o operador do grupo. */}
          <div className="w-[68px] shrink-0 pt-1.5">
            {index === 0 ? (
              <span className="block text-right text-xs font-medium uppercase text-content-subtle">
                Onde
              </span>
            ) : index === 1 ? (
              <LogicToggle
                value={value.logic}
                onChange={(logic) => onChange({ ...value, logic })}
              />
            ) : (
              <span className="block pt-1.5 text-right text-xs font-medium uppercase text-content-subtle">
                {value.logic === 'AND' ? 'e' : 'ou'}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {child.type === 'group' ? (
              <div className="space-y-2">
                <FilterBuilder
                  value={child}
                  onChange={(next) => updateChild(index, next)}
                  columns={columns}
                  datasetId={datasetId}
                  depth={depth + 1}
                />
              </div>
            ) : (
              <ConditionRow
                value={child}
                onChange={(next) => updateChild(index, next)}
                columns={columns}
                datasetId={datasetId}
              />
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            aria-label="Remover condicao"
            onClick={() => updateChild(index, null)}
            className="mt-0.5 shrink-0"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}

      <div className="flex gap-2 pl-[76px]">
        <Button variant="secondary" size="sm" onClick={addCondition}>
          <Plus className="size-3.5" aria-hidden="true" />
          Condicao
        </Button>
        {/* Profundidade limitada no contrato (6 niveis). Alem disso a interface
            deixa de ser legivel, e o objetivo era justamente ser legivel. */}
        {depth < 3 && (
          <Button variant="ghost" size="sm" onClick={addGroup}>
            <Plus className="size-3.5" aria-hidden="true" />
            Grupo
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Alternador E / OU.
 *
 * Botoes lado a lado em vez de um `<select>`: sao apenas duas opcoes, e a
 * escolha muda o significado de tudo abaixo. Ver as duas ao mesmo tempo, com a
 * ativa destacada, comunica melhor do que um campo que esconde a alternativa.
 */
function LogicToggle({
  value,
  onChange,
}: {
  value: LogicOperator;
  onChange: (next: LogicOperator) => void;
}) {
  return (
    <div
      className="flex overflow-hidden rounded-md border border-line-strong"
      role="group"
      aria-label="Conectivo entre as condicoes"
    >
      {(['AND', 'OR'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            'flex-1 px-1.5 py-1 text-xs font-medium transition-colors',
            value === option
              ? 'bg-brand text-white'
              : 'bg-surface text-content-muted hover:bg-surface-sunken',
          )}
        >
          {option === 'AND' ? 'E' : 'OU'}
        </button>
      ))}
    </div>
  );
}
