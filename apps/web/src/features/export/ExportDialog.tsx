import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import type { ExportFormat, Recipe } from '@excelflow/contracts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { api, ApiError, getAccessToken } from '@/lib/api-client';
import { cn, formatInteger } from '@/lib/utils';

const EXCEL_ROW_LIMIT = 1_048_575;

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  datasetId: string;
  recipe: Recipe;
  columns: string[];
  totalRows: number;
  hasMetrics: boolean;
  /** Regra salva aplicada, se houver -- aparece no historico. */
  recipeId?: string | null;
}

interface ExportOutcome {
  exportId: string;
  filename: string;
  rowCount: number;
  sizeBytes: number;
  format: ExportFormat;
}

export function ExportDialog({
  open,
  onClose,
  datasetId,
  recipe,
  columns,
  totalRows,
  hasMetrics,
  recipeId,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [selected, setSelected] = useState<string[]>(columns);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // As colunas do resultado mudam conforme as regras. Reabrir o dialogo tem de
  // refletir o resultado ATUAL, e nao a selecao de uma configuracao anterior.
  useEffect(() => {
    if (open) setSelected(columns);
  }, [open, columns]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ExportOutcome>(`/datasets/${datasetId}/export`, {
        recipe,
        format,
        columns: selected.length === columns.length ? undefined : selected,
        includeSummary: includeSummary && format === 'xlsx',
        metrics: recipe.metrics,
        recipeId: recipeId ?? null,
      }),
    onSuccess: (outcome) => {
      setError(null);
      void download(outcome.exportId, outcome.filename);
      onClose();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel exportar.');
    },
  });

  const willTruncate = format === 'xlsx' && totalRows > EXCEL_ROW_LIMIT;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exportar resultado"
      description={`${formatInteger(totalRows)} registro(s) serao exportados.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            loading={mutation.isPending}
            disabled={selected.length === 0}
            onClick={() => mutation.mutate()}
          >
            <Download className="size-4" aria-hidden="true" />
            Exportar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {willTruncate && (
          <Alert tone="warning" title="O resultado excede o limite do Excel">
            Uma planilha .xlsx comporta no maximo {formatInteger(EXCEL_ROW_LIMIT)} linhas. Exporte
            em CSV para levar todos os registros.
          </Alert>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-content">Formato</p>
          <div className="grid grid-cols-2 gap-2">
            <FormatOption
              active={format === 'xlsx'}
              onClick={() => setFormat('xlsx')}
              icon={FileSpreadsheet}
              title="Excel (.xlsx)"
              hint="Abre direto no Excel, com formatacao"
            />
            <FormatOption
              active={format === 'csv'}
              onClick={() => setFormat('csv')}
              icon={FileText}
              title="CSV"
              hint="Sem limite de linhas"
            />
          </div>
        </div>

        {format === 'xlsx' && hasMetrics && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSummary}
              onChange={(e) => setIncludeSummary(e.target.checked)}
              className="mt-0.5 size-4 rounded border-line-strong"
            />
            <span>
              <span className="font-medium text-content">Incluir aba &ldquo;Resumo&rdquo;</span>
              <span className="block text-xs text-content-subtle">
                Uma segunda aba com o total de registros e o resultado das analises.
              </span>
            </span>
          </label>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-content">Colunas</p>
            <button
              type="button"
              onClick={() => setSelected(selected.length === columns.length ? [] : columns)}
              className="text-xs text-brand hover:underline"
            >
              {selected.length === columns.length ? 'Desmarcar todas' : 'Marcar todas'}
            </button>
          </div>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-line bg-surface-muted p-2">
            {columns.map((name) => {
              const checked = selected.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setSelected(
                      checked ? selected.filter((item) => item !== name) : [...selected, name],
                    )
                  }
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
        </div>
      </div>
    </Modal>
  );
}

function FormatOption({
  active,
  onClick,
  icon: Icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-2.5 rounded-md border p-3 text-left transition-colors',
        active ? 'border-brand bg-brand-subtle' : 'border-line-strong hover:bg-surface-muted',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-brand' : 'text-content-subtle')}
            aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-content">{title}</span>
        <span className="block text-xs text-content-subtle">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Baixa o arquivo gerado.
 *
 * Nao da para usar um `<a href>` simples: a rota exige o cabecalho
 * Authorization, e um link comum nao o envia. Buscamos com fetch, criamos um
 * blob local e disparamos o download a partir dele.
 */
async function download(exportId: string, filename: string): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`/api/v1/exports/${exportId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });

  if (!response.ok) return;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Sem revogar, o blob fica na memoria da aba ate o usuario recarregar. Numa
  // sessao com varias exportacoes grandes, isso se acumula.
  URL.revokeObjectURL(url);
}
