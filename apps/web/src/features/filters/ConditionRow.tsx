import { useMemo } from 'react';
import type { ColumnProfile, FilterCondition, FilterOperator } from '@excelflow/contracts';
import { OPERATORS_BY_TYPE, OPERATOR_LABELS } from '@excelflow/contracts';
import { Select } from '@/components/ui/Select';
import { ValueField } from './ValueField';
import { nextId } from './filter-tree';

interface ConditionRowProps {
  value: FilterCondition;
  onChange: (next: FilterCondition) => void;
  columns: ColumnProfile[];
  datasetId: string;
}

const NULLARY = ['is_empty', 'is_not_empty', 'is_true', 'is_false'];
const LIST = ['in', 'not_in'];
const RANGE = ['between', 'date_between'];

/**
 * Uma condicao: COLUNA / CONDICAO / VALOR, na ordem em que se le em portugues.
 *
 * Os operadores oferecidos dependem do TIPO da coluna: nao faz sentido oferecer
 * "comeca com" numa coluna de valores, nem "maior que" numa de texto. Restringir
 * a lista evita que o usuario monte um filtro que so falha depois de aplicado.
 */
export function ConditionRow({ value, onChange, columns, datasetId }: ConditionRowProps) {
  const column = useMemo(
    () => columns.find((c) => c.name === value.column) ?? columns[0],
    [columns, value.column],
  );

  const operators = useMemo(
    () => (column ? (OPERATORS_BY_TYPE[column.type] as readonly FilterOperator[]) : []),
    [column],
  );

  function changeColumn(name: string) {
    const next = columns.find((c) => c.name === name);
    if (!next) return;
    const allowed = OPERATORS_BY_TYPE[next.type] as readonly FilterOperator[];
    // Se o operador atual nao existe para o novo tipo, cai no primeiro valido.
    // Sem isso, trocar de "Valor" para "Status" deixaria "maior que" numa
    // coluna de texto, e o filtro falharia so na hora de aplicar.
    const operator = allowed.includes(value.operator) ? value.operator : allowed[0]!;
    onChange(shapeFor(value, { column: name, operator }));
  }

  function changeOperator(operator: FilterOperator) {
    onChange(shapeFor(value, { operator }));
  }

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)]">
      <Select
        aria-label="Coluna"
        value={column?.name ?? ''}
        onChange={(e) => changeColumn(e.target.value)}
      >
        {columns.map((option) => (
          <option key={option.name} value={option.name}>
            {option.name}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Condicao"
        value={value.operator}
        onChange={(e) => changeOperator(e.target.value as FilterOperator)}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {OPERATOR_LABELS[operator]}
          </option>
        ))}
      </Select>

      {NULLARY.includes(value.operator) ? (
        <div />
      ) : (
        <ValueField
          condition={value}
          column={column}
          datasetId={datasetId}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/**
 * Ajusta a FORMA da condicao ao trocar de operador, preservando o que fizer
 * sentido.
 *
 * Cada aridade tem forma propria: `between` guarda `range`, `in` guarda
 * `values`, `equals` guarda `value`, e `is_empty` nao guarda nada. Trocar de
 * "igual a" para "entre" precisa criar o `range`, senao o schema recusa a
 * condicao e o usuario nao entende por que o filtro parou de funcionar.
 *
 * O `switch` e explicito de proposito: um spread generico impediria o
 * TypeScript de estreitar a uniao discriminada, e o erro so apareceria em
 * tempo de execucao.
 */
function shapeFor(
  previous: FilterCondition,
  changes: { column?: string; operator?: FilterOperator },
): FilterCondition {
  const common = {
    type: 'condition' as const,
    id: previous.id ?? nextId(),
    column: changes.column ?? previous.column,
    ...('caseSensitive' in previous && previous.caseSensitive !== undefined
      ? { caseSensitive: previous.caseSensitive }
      : {}),
  };

  const operator = changes.operator ?? previous.operator;

  switch (operator) {
    case 'is_empty':
    case 'is_not_empty':
    case 'is_true':
    case 'is_false':
      return { ...common, operator };

    case 'in':
    case 'not_in':
      return {
        ...common,
        operator,
        values: 'values' in previous ? previous.values : [],
      };

    case 'between':
    case 'date_between':
      return {
        ...common,
        operator,
        range: 'range' in previous ? previous.range : ['', ''],
      };

    default:
      return {
        ...common,
        operator,
        value: 'value' in previous ? previous.value : '',
      };
  }
}
