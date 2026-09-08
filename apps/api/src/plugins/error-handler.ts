import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiErrorBody } from '@excelflow/contracts';
import { AppError } from '../lib/errors.js';

/**
 * Tradutor unico de excecoes para respostas HTTP.
 *
 * Regra de ouro: um erro so vira mensagem para o cliente se tiver sido lancado
 * deliberadamente como AppError. Qualquer outra excecao -- falha de driver,
 * TypeError, timeout -- e registrada no log com todo o detalhe e devolvida como
 * "erro interno" generico. Mensagem de erro de banco revela nome de tabela,
 * versao e estrutura; isso e reconhecimento gratuito para um atacante.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = {
      error: {
        code: 'NOT_FOUND',
        message: `Rota nao encontrada: ${request.method} ${request.url}`,
        requestId: request.id,
      },
    };
    reply.code(404).send(body);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.info(
        { code: error.code, statusCode: error.statusCode, path: request.url },
        error.message,
      );
      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId: request.id,
        },
      };
      return reply.code(error.statusCode).send(body);
    }

    // Erros gerados pelo proprio Fastify (JSON malformado, limite de corpo,
    // rate limit) ja trazem statusCode e mensagem seguros.
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;

    if (statusCode < 500) {
      request.log.info({ err: error, path: request.url }, 'Requisicao rejeitada');
      const body: ApiErrorBody = {
        error: {
          code: statusCode === 429 ? 'RATE_LIMITED' : 'VALIDATION_ERROR',
          message: error.message,
          requestId: request.id,
        },
      };
      return reply.code(statusCode).send(body);
    }

    request.log.error({ err: error, path: request.url }, 'Erro nao tratado');
    const body: ApiErrorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor. Tente novamente em instantes.',
        requestId: request.id,
      },
    };
    return reply.code(500).send(body);
  });
}
