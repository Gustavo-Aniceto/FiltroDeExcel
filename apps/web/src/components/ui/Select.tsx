import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

/**
 * `<select>` nativo, e nao um combobox customizado.
 *
 * O nativo ja traz busca por digitacao, navegacao por teclado, acessibilidade e
 * o seletor em roda no celular -- tudo que uma reimplementacao levaria semanas
 * para acertar e ainda erraria em algum navegador. So estilizamos a moldura.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, label, error, id, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-content">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'w-full appearance-none rounded-md border bg-surface py-2 pl-3 pr-9 text-sm text-content',
            'transition-colors disabled:cursor-not-allowed disabled:bg-surface-muted',
            error ? 'border-danger' : 'border-line-strong',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
          aria-hidden="true"
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
});
