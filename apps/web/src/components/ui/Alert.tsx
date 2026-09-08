import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { wrapper: string; icon: typeof Info }> = {
  info: { wrapper: 'bg-brand-subtle text-content border-brand/20', icon: Info },
  success: { wrapper: 'bg-success-subtle text-content border-success/20', icon: CheckCircle2 },
  warning: { wrapper: 'bg-warning-subtle text-content border-warning/20', icon: TriangleAlert },
  danger: { wrapper: 'bg-danger-subtle text-content border-danger/20', icon: AlertCircle },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { wrapper, icon: Icon } = TONES[tone];
  return (
    <div
      // role="alert" faz o leitor de tela anunciar a mensagem assim que ela
      // aparece -- essencial para erros de formulario que surgem apos o envio.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border px-4 py-3 text-sm', wrapper, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-content-muted')}>{children}</div>}
      </div>
    </div>
  );
}
