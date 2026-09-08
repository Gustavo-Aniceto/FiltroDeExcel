import { useCallback, useRef, useState, type DragEvent } from 'react';
import { FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { SUPPORTED_EXTENSIONS } from '@excelflow/contracts';
import { Alert } from '@/components/ui/Alert';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const ACCEPT = SUPPORTED_EXTENSIONS.join(',');

type Phase = 'idle' | 'uploading' | 'processing';

interface UploadDropzoneProps {
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<void>;
  maxSizeMb?: number;
}

/**
 * Area de envio por arrastar-e-soltar.
 *
 * E a tela mais importante do sistema: o primeiro contato do usuario, e precisa
 * funcionar sem nenhuma instrucao previa.
 */
export function UploadDropzone({ onUpload, maxSizeMb = 100 }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Um contador, e nao um booleano: `dragleave` dispara ao passar sobre cada
  // elemento FILHO da area. Com booleano, a moldura de destaque piscaria sem
  // parar enquanto o usuario move o arquivo por cima.
  const dragDepth = useRef(0);

  const busy = phase !== 'idle';

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setFilename(file.name);
      setProgress(0);
      setPhase('uploading');

      try {
        await onUpload(file, (percent) => {
          setProgress(percent);
          // 100% de bytes enviados nao e o fim: o servidor ainda converte e
          // perfila a planilha. Trocar o rotulo aqui evita a barra "completa"
          // parada, que passa a impressao de travamento.
          if (percent >= 100) setPhase('processing');
        });
      } catch (uploadError) {
        setError(
          uploadError instanceof ApiError
            ? uploadError.message
            : 'Nao foi possivel enviar o arquivo.',
        );
      } finally {
        setPhase('idle');
        setProgress(0);
        // Limpa o input para que reenviar O MESMO arquivo dispare `change` de
        // novo -- sem isso, a segunda tentativa com o mesmo arquivo nao ocorre.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onUpload],
  );

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-3">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          if (!busy) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!busy && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="Enviar planilha"
        aria-busy={busy}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors',
          busy
            ? 'cursor-default border-line-strong bg-surface'
            : 'cursor-pointer border-line-strong bg-surface hover:border-brand hover:bg-brand-subtle',
          dragging && 'border-brand bg-brand-subtle',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        {busy ? (
          <>
            <div className="flex size-12 items-center justify-center rounded-full bg-brand-subtle">
              <Loader2 className="size-6 animate-spin text-brand" aria-hidden="true" />
            </div>
            <div className="w-full max-w-sm">
              <p className="flex items-center justify-center gap-2 font-medium text-content">
                <FileSpreadsheet className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{filename}</span>
              </p>
              <p className="mt-1 text-sm text-content-muted">
                {phase === 'uploading' ? `Enviando... ${progress}%` : 'Analisando a planilha...'}
              </p>
              <div
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
                role="progressbar"
                aria-valuenow={phase === 'uploading' ? progress : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progresso do envio"
              >
                <div
                  className={cn(
                    'h-full rounded-full bg-brand transition-[width] duration-200',
                    // Na fase de processamento nao existe progresso mensuravel:
                    // uma barra cheia e animada e honesta; uma barra parada em
                    // 100% parece travada.
                    phase === 'processing' && 'animate-pulse',
                  )}
                  style={{ width: phase === 'processing' ? '100%' : `${progress}%` }}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex size-12 items-center justify-center rounded-full bg-surface-sunken">
              <UploadCloud className="size-6 text-content-subtle" aria-hidden="true" />
            </div>
            <div>
              <p className="font-medium text-content">Arraste sua planilha aqui</p>
              <p className="mt-1 text-sm text-content-subtle">
                ou clique para selecionar &middot; {SUPPORTED_EXTENSIONS.join(', ')} &middot; ate{' '}
                {maxSizeMb} MB
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Nao foi possivel processar a planilha">
          {error}
        </Alert>
      )}
    </div>
  );
}
