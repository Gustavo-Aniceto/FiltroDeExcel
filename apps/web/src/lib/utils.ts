import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina classes Tailwind resolvendo conflitos.
 *
 * `twMerge` garante que a ultima classe conflitante vence: em
 * `cn('px-2', 'px-4')` sobra apenas `px-4`. Sem isso, a ordem no CSS gerado
 * decidiria o resultado, e componentes ficariam impossiveis de customizar via
 * prop `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return currencyFormatter.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return numberFormatter.format(value);
}

export function formatInteger(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return integerFormatter.format(value);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Formata um valor categorico para exibicao.
 *
 * O motor devolve booleanos serializados como "true"/"false" -- correto no
 * dado, ruim na tela: o usuario escreveu "Sim"/"Nao" na planilha dele e espera
 * ver "Sim"/"Nao" de volta.
 */
export function formatCategoryValue(value: string, columnType: string): string {
  if (columnType !== 'boolean') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return 'Sim';
  if (normalized === 'false') return 'Nao';
  return value;
}
