import { useMemo } from 'react';
import {
  Columns3,
  CopyCheck,
  Rows3,
  SquareAsterisk,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { ColumnProfile, DatasetProfile } from '@excelflow/contracts';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { formatCurrency, formatInteger, formatNumber } from '@/lib/utils';
import { CategoryBars } from './CategoryBars';
import { ColumnProfileTable } from './ColumnProfileTable';
import { StatCard } from './StatCard';

/**
 * Escolhe a coluna monetaria "principal" do dashboard.
 *
 * Uma planilha pode ter varias colunas de valor (bruto, liquido, desconto). Sem
 * saber a intencao do usuario, a maior soma absoluta e a melhor aproximacao do
 * que ele veio olhar -- e a coluna secundaria continua acessivel na tabela.
 */
function pickPrimaryMoneyColumn(columns: ColumnProfile[]): ColumnProfile | null {
  const candidates = columns.filter(
    (c) => (c.type === 'currency' || c.type === 'number') && c.sum != null,
  );
  if (candidates.length === 0) return null;

  const currency = candidates.filter((c) => c.type === 'currency');
  const pool = currency.length > 0 ? currency : candidates;

  return pool.reduce((best, current) =>
    Math.abs(current.sum ?? 0) > Math.abs(best.sum ?? 0) ? current : best,
  );
}

/**
 * Colunas categoricas que valem um grafico.
 *
 * O criterio e util, nao estetico: uma coluna com 2 a 15 valores distintos
 * descreve uma DIMENSAO (Status, Banco, Agencia). Uma com 4.500 valores
 * distintos e um identificador -- seu grafico seria ruido.
 */
function pickCategoricalColumns(columns: ColumnProfile[]): ColumnProfile[] {
  return columns
    .filter(
      (c) =>
        (c.type === 'text' || c.type === 'boolean') &&
        c.topValues != null &&
        c.topValues.length >= 2 &&
        c.distinctCount <= 15,
    )
    .sort((a, b) => a.distinctCount - b.distinctCount)
    .slice(0, 4);
}

export function DatasetDashboard({ profile }: { profile: DatasetProfile }) {
  const { dataset, columns } = profile;

  const money = useMemo(() => pickPrimaryMoneyColumn(columns), [columns]);
  const categorical = useMemo(() => pickCategoricalColumns(columns), [columns]);
  const dateColumn = useMemo(() => columns.find((c) => c.type === 'date' && c.minDate), [columns]);

  const isCurrency = money?.type === 'currency';
  const money$ = (value: number | null | undefined) =>
    isCurrency ? formatCurrency(value) : formatNumber(value);

  const duplicatePercent =
    dataset.rowCount > 0 ? (dataset.duplicateRowCount / dataset.rowCount) * 100 : 0;
  const emptyPercent =
    dataset.rowCount > 0 ? (dataset.rowsWithEmptyCount / dataset.rowCount) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Estrutura da planilha: sempre presente, independentemente das colunas. */}
      <section aria-labelledby="estrutura">
        <h2 id="estrutura" className="sr-only">
          Estrutura da planilha
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total de registros"
            value={formatInteger(dataset.rowCount)}
            icon={Rows3}
            hint={dataset.sheetName ? `Aba: ${dataset.sheetName}` : undefined}
          />
          <StatCard
            label="Colunas"
            value={formatInteger(dataset.columnCount)}
            icon={Columns3}
          />
          <StatCard
            label="Registros duplicados"
            value={formatInteger(dataset.duplicateRowCount)}
            icon={CopyCheck}
            tone={dataset.duplicateRowCount > 0 ? 'warning' : 'neutral'}
            hint={
              dataset.duplicateRowCount > 0
                ? `${duplicatePercent.toFixed(1).replace('.', ',')}% do total`
                : 'Nenhuma linha repetida'
            }
          />
          <StatCard
            label="Linhas com vazio"
            value={formatInteger(dataset.rowsWithEmptyCount)}
            icon={SquareAsterisk}
            tone={emptyPercent > 20 ? 'warning' : 'neutral'}
            hint={
              dataset.rowsWithEmptyCount > 0
                ? `${emptyPercent.toFixed(1).replace('.', ',')}% do total`
                : 'Nenhuma celula vazia'
            }
          />
        </div>
      </section>

      {/* Bloco de valores: so aparece quando existe coluna numerica. O dashboard
          se monta a partir do que a planilha tem, e nao de um layout fixo. */}
      {money && (
        <section aria-labelledby="valores">
          <h2 id="valores" className="mb-3 text-sm font-medium text-content-muted">
            {money.name}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Soma" value={money$(money.sum)} tone="success" />
            <StatCard label="Media" value={money$(money.avg)} />
            <StatCard label="Maior valor" value={money$(money.max)} icon={TrendingUp} />
            <StatCard label="Menor valor" value={money$(money.min)} icon={TrendingDown} />
          </div>
        </section>
      )}

      {dateColumn?.minDate && (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="text-sm text-content-muted">
              Periodo em <span className="font-medium text-content">{dateColumn.name}</span>
            </span>
            <span className="text-sm font-medium tabular-nums text-content">
              {new Date(dateColumn.minDate).toLocaleDateString('pt-BR')}
              <span className="mx-2 text-content-subtle">ate</span>
              {dateColumn.maxDate && new Date(dateColumn.maxDate).toLocaleDateString('pt-BR')}
            </span>
          </CardBody>
        </Card>
      )}

      {categorical.length > 0 && (
        <section aria-labelledby="distribuicoes">
          <h2 id="distribuicoes" className="sr-only">
            Distribuicao por categoria
          </h2>
          {/* `items-start` impede que um cartao de 2 barras estique ate a altura do
                vizinho de 6 -- o espaco vazio faria parecer que faltou conteudo. */}
            <div className="grid items-start gap-4 lg:grid-cols-2">
            {categorical.map((column) => (
              <Card key={column.name}>
                <CardHeader
                  title={column.name}
                  description={`${formatInteger(column.distinctCount)} valores distintos`}
                />
                <CardBody>
                  <CategoryBars
                    data={column.topValues ?? []}
                    total={dataset.rowCount}
                    columnType={column.type}
                  />
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Card>
        <CardHeader
          title="Colunas detectadas"
          description="Tipo inferido, valores vazios e resumo de cada coluna."
        />
        <CardBody className="p-0">
          <ColumnProfileTable columns={columns} rowCount={dataset.rowCount} />
        </CardBody>
      </Card>
    </div>
  );
}
