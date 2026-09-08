import type { ApiErrorDetail, ErrorCode } from '@excelflow/contracts';

/**
 * Erro de aplicacao com codigo e status HTTP explicitos.
 *
 * Erros lancados como AppError sao considerados SEGUROS para exibir ao
 * usuario. Qualquer outra excecao vira "INTERNAL_ERROR" com mensagem generica:
 * mensagens de driver de banco e stack traces vazam estrutura interna e nao
 * devem sair da API.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ApiErrorDetail[] | undefined;
  readonly expose = true;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static validation(message = 'Dados invalidos', details?: ApiErrorDetail[]): AppError {
    return new AppError('VALIDATION_ERROR', message, 400, details);
  }

  static unauthorized(message = 'Autenticacao necessaria'): AppError {
    return new AppError('UNAUTHORIZED', message, 401);
  }

  static forbidden(message = 'Acesso negado'): AppError {
    return new AppError('FORBIDDEN', message, 403);
  }

  static notFound(message = 'Recurso nao encontrado'): AppError {
    return new AppError('NOT_FOUND', message, 404);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message, 409);
  }

  static payloadTooLarge(message: string): AppError {
    return new AppError('PAYLOAD_TOO_LARGE', message, 413);
  }

  static unsupportedMedia(message: string): AppError {
    return new AppError('UNSUPPORTED_MEDIA_TYPE', message, 415);
  }

  static engine(message = 'Falha no motor de processamento'): AppError {
    return new AppError('ENGINE_ERROR', message, 502);
  }
}
