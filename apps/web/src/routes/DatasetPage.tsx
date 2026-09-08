import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { DatasetDashboard } from '@/features/dashboard/DatasetDashboard';
import { datasetKeys, fetchDatasetProfile } from '@/features/datasets/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

export default function DatasetPage() {
  const { id = '' } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: datasetKeys.detail(id),
    queryFn: () => fetchDatasetProfile(id),
    enabled: id.length > 0,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Carregando analise" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert tone="danger" title="Nao foi possivel abrir a planilha">
          {error instanceof ApiError ? error.message : 'Tente novamente em instantes.'}
        </Alert>
      </div>
    );
  }

  const { dataset } = data;

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-content">
            {dataset.originalFilename}
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            Enviada em {formatDateTime(dataset.createdAt)}
          </p>
        </div>

        {/* A validade e informacao, nao detalhe tecnico: o usuario precisa saber
            que a planilha sai do servidor sozinha, e ate quando pode reabri-la. */}
        {dataset.status !== 'expired' && dataset.expiresAt && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-sunken px-2.5 py-1 text-xs text-content-muted">
            <Clock className="size-3.5" aria-hidden="true" />
            Disponivel ate {formatDateTime(dataset.expiresAt)}
          </span>
        )}
      </div>

      {dataset.status === 'expired' && (
        <Alert tone="warning" title="Dados nao estao mais disponiveis">
          Os arquivos desta planilha foram removidos automaticamente apos o prazo de retencao.
          A analise abaixo continua disponivel, mas para filtrar ou exportar sera preciso enviar
          a planilha novamente.
        </Alert>
      )}

      <DatasetDashboard profile={data} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para planilhas
    </Link>
  );
}
