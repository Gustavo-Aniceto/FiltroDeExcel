import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

/**
 * Dialogo construido sobre `<dialog>` nativo.
 *
 * O elemento nativo entrega de graca: foco preso dentro do dialogo, Escape para
 * fechar, camada superior acima de qualquer z-index, e o fundo inerte para
 * leitores de tela. Reimplementar isso e a fonte classica de modal que prende o
 * usuario ou que o Tab escapa por baixo.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // `cancel` cobre o Escape; sem isto o dialogo fecharia sozinho e o estado
    // do React continuaria achando que esta aberto.
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={cn(
        'w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-0 text-content shadow-xl',
        'backdrop:bg-black/40',
        SIZES[size],
      )}
      // Clicar no fundo fecha. O clique dentro do conteudo nao propaga ate aqui.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-content-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="-mr-1 -mt-1 rounded p-1 text-content-subtle transition-colors hover:bg-surface-sunken hover:text-content"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>

      {footer && (
        <div className="flex justify-end gap-2 border-t border-line bg-surface-muted px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
