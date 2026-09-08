import { Link } from 'react-router-dom';
import { AlertCircle, Clock, FileSpreadsheet, Trash2 } from 'lucide-react';
import type { Dataset } from '@excelflow/contracts';
import { Button } from '@/components/ui/Button';
import { formatDateTime, formatInteger } from '@/lib/utils';

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DatasetList({
  datasets,
  onDelete,
  deletingId,
}: {
  datasets: Dataset[];
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  if (datasets.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-content-subtle">
        Nenhuma planilha enviada ainda.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {datasets.map((dataset) => {
        const failed = dataset.status === 'failed';
        // Uma planilha expirada mantem o PERFIL no banco -- o dashboard
        // continua abrindo e mostrando a analise. O que se perdeu foram os
        // dados para filtrar e exportar, e isso precisa ficar visivel.
        const expired = dataset.status === 'expired';
        const content = (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {failed ? (
              <AlertCircle className="size-5 shrink-0 text-danger" aria-hidden="true" />
            ) : expired ? (
              <Clock className="size-5 shrink-0 text-content-subtle" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="size-5 shrink-0 text-content-subtle" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-medium text-content">
                <span className="truncate">{dataset.originalFilename}</span>
                {expired && (
                  <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-normal text-content-subtle">
                    Expirada
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-content-subtle">
                {failed ? (
                  <span className="text-danger">
                    {dataset.errorMessage ?? 'Falha ao processar'}
                  </span>
                ) : (
                  <>
                    {formatInteger(dataset.rowCount)} linhas &middot;{' '}
                    {formatInteger(dataset.columnCount)} colunas &middot; {sizeLabel(dataset.sizeBytes)}
                  </>
                )}
              </p>
            </div>
            <span className="hidden shrink-0 text-xs text-content-subtle sm:block">
              {formatDateTime(dataset.createdAt)}
            </span>
          </div>
        );

        return (
          <li key={dataset.id} className="flex items-center gap-2 px-5 py-3 hover:bg-surface-muted">
            {/* Um dataset que falhou nao tem dashboard para abrir; deixar o
                link ativo levaria a uma tela vazia sem explicacao. */}
            {failed ? (
              <div className="flex min-w-0 flex-1">{content}</div>
            ) : (
              <Link to={`/planilhas/${dataset.id}`} className="flex min-w-0 flex-1">
                {content}
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Excluir ${dataset.originalFilename}`}
              loading={deletingId === dataset.id}
              onClick={() => onDelete(dataset.id)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
