import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_PAGE_SIZE,
  exportRequestSchema,
  metricSchema,
  paginationQuerySchema,
  recipeSchema,
} from '@excelflow/contracts';
import { AppError } from '../../lib/errors.js';
import { resolveWithinStorage } from '../../lib/storage.js';
import { validate } from '../../lib/validation.js';
import * as executionsRepo from '../executions/executions.repository.js';
import * as service from './query.service.js';

function contextOf(request: FastifyRequest): service.RequestContext {
  const ua = request.headers['user-agent'];
  return {
    userId: request.currentUser!.id,
    ipAddress: request.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null,
  };
}

const previewBodySchema = z.object({
  recipe: recipeSchema,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  search: z.string().max(200).nullable().optional(),
  metrics: z.array(metricSchema).max(50).optional(),
});

const executeBodySchema = z.object({
  recipe: recipeSchema,
  recipeId: z.string().uuid().nullable().optional(),
  metrics: z.array(metricSchema).max(50).optional(),
});

const columnValuesSchema = z.object({
  column: z.string().min(1).max(255),
  search: z.string().max(200).nullable().optional(),
});

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /**
   * Previa das regras. E chamada a cada ajuste de filtro, entao o limite e
   * generoso -- mas existe: uma previa executa uma consulta analitica completa,
   * e um cliente em laco derrubaria o engine.
   */
  app.post(
    '/datasets/:id/preview',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = validate(previewBodySchema, request.body);
      return reply.send(await service.preview(id, body, contextOf(request)));
    },
  );

  app.post('/datasets/:id/column-values', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(columnValuesSchema, request.body);
    const values = await service.columnValues(
      id,
      body.column,
      body.search ?? null,
      contextOf(request),
    );
    return reply.send({ values });
  });

  app.get('/datasets/:id/suggested-metrics', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ metrics: await service.suggestedMetrics(id, contextOf(request)) });
  });

  app.post('/datasets/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(executeBodySchema, request.body);
    return reply.send(await service.execute(id, body, contextOf(request)));
  });

  app.post(
    '/datasets/:id/export',
    {
      // Exportar percorre o resultado inteiro e escreve um arquivo. Bem mais
      // caro que uma previa, e com limite proporcionalmente mais rigido.
      config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = validate(
        exportRequestSchema.extend({
          recipe: recipeSchema,
          metrics: z.array(metricSchema).max(50).optional(),
          recipeId: z.string().uuid().nullable().optional(),
        }),
        request.body,
      );
      return reply.send(await service.exportResult(id, body, contextOf(request)));
    },
  );

  /**
   * Download do arquivo exportado.
   *
   * O caminho vem do banco, filtrado por user_id -- nunca da requisicao. Aceitar
   * um caminho do cliente aqui seria leitura arbitraria de arquivos do servidor.
   */
  app.get('/exports/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await executionsRepo.findExport(id, request.currentUser!.id);
    if (!record) {
      throw AppError.notFound('Arquivo nao encontrado.');
    }

    let absolute: string;
    try {
      absolute = resolveWithinStorage(record.storage_path);
    } catch {
      throw AppError.notFound('Arquivo nao encontrado.');
    }

    const stream = createReadStream(absolute);
    stream.on('error', () => {
      // O arquivo pode ter expirado entre a listagem e o clique.
      if (!reply.sent) {
        reply.code(410).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Este arquivo expirou. Gere a exportacao novamente.',
          },
        });
      }
    });

    await executionsRepo.markExportDownloaded(id);

    const filename = service.safeDownloadName(record.filename);
    const contentType =
      record.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return reply
      .header('Content-Type', contentType)
      // `filename*` com RFC 5987 preserva acentos no nome do arquivo baixado;
      // sem ele, "operações.xlsx" chega quebrado no Windows.
      .header(
        'Content-Disposition',
        `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; ` +
          `filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      .send(stream);
  });

  app.get('/executions', async (request, reply) => {
    const { page, pageSize } = validate(paginationQuerySchema, request.query);
    const { items, total } = await executionsRepo.listExecutions(
      request.currentUser!.id,
      page,
      pageSize,
    );
    return reply.send({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  });

  app.get('/executions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await executionsRepo.findExecution(id, request.currentUser!.id);
    if (!found) {
      throw AppError.notFound('Processamento nao encontrado.');
    }
    return reply.send(found);
  });
}
