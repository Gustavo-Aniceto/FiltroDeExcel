import type { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Valida dados contra um schema Zod e converte a falha no formato de erro da
 * API.
 *
 * Optamos por validar explicitamente nos handlers em vez de acoplar a API a um
 * type-provider: o custo e uma linha por rota, e o ganho e controle total sobre
 * o formato do erro -- que o frontend consome para destacar campos.
 */
export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  throw AppError.validation(
    'Dados invalidos',
    result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(raiz)',
      message: issue.message,
    })),
  );
}
