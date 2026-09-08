import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronRight, History } from 'lucide-react';
import type { Execution, MetricResult, Paginated, Recipe } from '@excelflow/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { api } from '@/lib/api-client';
import { formatDateTime, formatInteger } from '@/lib/utils';
import { formatMetric } from '@/features/analysis/AnalysisPanel';

interface ExecutionDetail {
  execution: Execution;
  definition: Recipe;
  metrics: MetricResult[];
}

/**
 * Historico de processamentos.
 *
 * Responde "o que rodei, quando, sobre qual arquivo e o que deu". Cada execucao
 * guarda o SNAPSHOT da regra usada, entao abrir um processamento antigo mostra
 * exatamente as regras daquele momento -- mesmo que a regra tenha sido editada
 * ou excluida depois.
 */
export default function HistoryPage() {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['executions', page],
    queryFn: () => api.get<Paginated<Execution>>(`/executions?page=${page}&pageSize=20`),
  });

  const { data: detail } = useQuery({
    queryKey: ['execution', openId],
    queryFn: () => api.get<ExecutionDetail>(`/executions/${openId}`),
    enabled: openId !== null,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-content">Historico</h1>
        <p className="mt-1 text-sm text-content-muted">
          Todos os processamentos executados, com as regras aplicadas e os resultados.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Processamentos"
          description={data ? `${formatInteger(data.total)} no total` : 'Carregando'}
        />
        <CardBody className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Carregando historico" />
            </div>
          ) : data && data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th scope="col" className="px-5 py-2.5 font-medium text-content-muted">Data</th>
                      <th scope="col" className="px-3 py-2.5 font-medium text-content-muted">Arquivo</th>
                      <th scope="col" className="px-3 py-2.5 font-medium text-content-muted">Regra</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium text-content-muted">Resultado</th>
                      <th scope="col" className="px-3 py-2.5 font-medium text-content-muted">Usuario</th>
                      <th scope="col" className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((execution) => (
                      <tr key={execution.id} className="hover:bg-surface-muted">
                        <td className="whitespace-nowrap px-5 py-2.5 text-content-muted">
                          {formatDateTime(execution.createdAt)}
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-2.5 font-medium text-content">
                          {execution.datasetName}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 text-content-muted">
                          {execution.recipeName ?? <span className="text-content-subtle">Regras avulsas</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {execution.status === 'failed' ? (
                            <Badge tone="danger">
                              <AlertCircle className="size-3" aria-hidden="true" />
                              falhou
                            </Badge>
                          ) : (
                            <span className="text-content">
                              {formatInteger(execution.outputRowCount)}
                              <span className="ml-1 text-xs text-content-subtle">
                                de {formatInteger(execution.inputRowCount)}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-2.5 text-content-muted">
                          {execution.createdByName ?? '--'}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setOpenId(execution.id)}>
                            Ver
                            <ChevronRight className="size-3.5" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-line px-5 py-2.5">
                  <span className="text-xs text-content-muted">
                    Pagina {data.page} de {data.totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={page <= 1}
                            onClick={() => setPage(page - 1)}>Anterior</Button>
                    <Button variant="ghost" size="sm" disabled={page >= data.totalPages}
                            onClick={() => setPage(page + 1)}>Proxima</Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <History className="size-8 text-content-subtle" aria-hidden="true" />
              <p className="text-sm text-content-muted">Nenhum processamento executado ainda.</p>
              <Link to="/" className="text-sm text-brand hover:underline">
                Enviar uma planilha
              </Link>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title="Detalhes do processamento"
        description={detail ? formatDateTime(detail.execution.createdAt) : undefined}
        size="lg"
      >
        {detail && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-content-subtle">Arquivo</dt>
                <dd className="font-medium text-content">{detail.execution.datasetName}</dd>
              </div>
              <div>
                <dt className="text-content-subtle">Regra</dt>
                <dd className="font-medium text-content">
                  {detail.execution.recipeName ?? 'Regras avulsas'}
                </dd>
              </div>
              <div>
                <dt className="text-content-subtle">Registros</dt>
                <dd className="font-medium text-content">
                  {formatInteger(detail.execution.outputRowCount)} de{' '}
                  {formatInteger(detail.execution.inputRowCount)}
                </dd>
              </div>
              <div>
                <dt className="text-content-subtle">Duracao</dt>
                <dd className="font-medium text-content">{detail.execution.durationMs} ms</dd>
              </div>
            </dl>

            {detail.execution.errorMessage && (
              <div className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-sm text-content">
                {detail.execution.errorMessage}
              </div>
            )}

            {detail.metrics.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-content">Analises</p>
                <ul className="divide-y divide-line rounded-md border border-line">
                  {detail.metrics.map((metric) => (
                    <li key={metric.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-content-muted">{metric.label}</span>
                      <span className="font-medium tabular-nums text-content">
                        {formatMetric(metric)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium text-content">Regras aplicadas</p>
              {/* JSON cru de proposito: e a definicao EXATA que rodou, util para
                  conferir e para reportar um problema com precisao. */}
              <pre className="max-h-64 overflow-auto rounded-md border border-line bg-surface-muted p-3 font-mono text-xs text-content-muted">
                {JSON.stringify(detail.definition, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
