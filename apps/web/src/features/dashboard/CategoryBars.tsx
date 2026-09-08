import { useId } from 'react';
import type { ColumnType } from '@excelflow/contracts';
import { formatCategoryValue, formatInteger } from '@/lib/utils';

export interface CategoryDatum {
  value: string;
  count: number;
}

interface CategoryBarsProps {
  data: CategoryDatum[];
  total: number;
  columnType: ColumnType;
}

/**
 * Barras horizontais para distribuicao de uma coluna categorica.
 *
 * Escolha da forma: o dado responde "qual a magnitude por identidade" -- quantos
 * registros em cada Status. Barras horizontais sao a resposta certa porque os
 * rotulos sao textos de comprimento variavel ("EM ANALISE"), que em barras
 * verticais teriam de ser girados e ficariam ilegiveis.
 *
 * Nao ha legenda: ha uma unica serie, e o titulo do cartao ja a nomeia. Os
 * valores vao rotulados diretamente, o que dispensa eixo e grade.
 *
 * Feito em HTML/CSS, sem biblioteca de graficos: para barras deitadas, uma
 * biblioteca custaria dezenas de KB no bundle para entregar exatamente isto.
 */
export function CategoryBars({ data, total, columnType }: CategoryBarsProps) {
  const headingId = useId();
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="space-y-2.5">
      <ul className="space-y-2.5" aria-describedby={headingId}>
        {data.map((item) => {
          const percent = total > 0 ? (item.count / total) * 100 : 0;
          const label = formatCategoryValue(item.value, columnType);
          return (
            <li key={item.value}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-content" title={label}>
                  {label}
                </span>
                {/* Rotulo direto no lugar de eixo: em ate 15 categorias, ler o
                    numero e mais rapido do que estima-lo contra uma grade. */}
                <span className="shrink-0 tabular-nums text-content-muted">
                  {formatInteger(item.count)}
                  <span className="ml-1.5 text-xs text-content-subtle">
                    {percent.toFixed(1).replace('.', ',')}%
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-[#2a78d6]"
                  style={{ width: `${(item.count / max) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p id={headingId} className="sr-only">
        Distribuicao de valores, do mais frequente ao menos frequente.
      </p>
    </div>
  );
}
