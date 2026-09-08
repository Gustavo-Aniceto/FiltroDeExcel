import { z } from 'zod';

/** Identificador universal usado por todas as entidades. */
export const uuidSchema = z.string().uuid();

/**
 * Nome de coluna vindo de uma planilha.
 *
 * Note que NAO restringimos os caracteres: cabecalhos reais contem acentos,
 * espacos, barras e parenteses ("Valor da operacao (R$)"). A seguranca contra
 * injecao nao vem de sanitizar o nome, e sim de validar cada coluna contra o
 * perfil registrado do dataset antes de compilar SQL (ver ARCHITECTURE 5.3).
 */
export const columnNameSchema = z.string().min(1).max(255);

/** Limite rigido de linhas devolvidas por qualquer endpoint de leitura. */
export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 50;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Codigos de erro estaveis. O front pode reagir a eles sem ler a mensagem. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'ENGINE_ERROR',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** Formato unico de erro em toda a API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}
