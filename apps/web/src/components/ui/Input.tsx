import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, hint, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-content">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        // aria-invalid + aria-describedby fazem o leitor de tela anunciar o
        // erro. Pintar a borda de vermelho comunica apenas a quem enxerga.
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, hint && hintId) || undefined}
        className={cn(
          'w-full rounded-md border bg-surface px-3 py-2 text-sm',
          'text-content placeholder:text-content-subtle',
          'transition-colors duration-150',
          'disabled:cursor-not-allowed disabled:bg-surface-muted',
          error
            ? 'border-danger focus-visible:outline-danger'
            : 'border-line-strong',
          className,
        )}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-content-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
