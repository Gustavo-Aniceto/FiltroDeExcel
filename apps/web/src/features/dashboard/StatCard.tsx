import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'warning' | 'danger' | 'success';

const TONE_ACCENT: Record<Tone, string> = {
  neutral: 'text-content-subtle',
  warning: 'text-warning',
  danger: 'text-danger',
  success: 'text-success',
};

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}

/**
 * Numero-destaque.
 *
 * A escolha e deliberada: para um valor unico, um cartao com o numero grande
 * comunica melhor do que qualquer grafico. Grafico e para comparar; aqui nao ha
 * comparacao, ha um fato.
 */
export function StatCard({ label, value, hint, icon: Icon, tone = 'neutral' }: StatCardProps) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-content-subtle">
          {label}
        </p>
        {Icon && <Icon className={cn('size-4 shrink-0', TONE_ACCENT[tone])} aria-hidden="true" />}
      </div>
      <p
        className={cn(
          'mt-1.5 text-2xl font-semibold tracking-tight',
          tone === 'neutral' ? 'text-content' : TONE_ACCENT[tone],
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-content-subtle">{hint}</p>}
    </div>
  );
}
