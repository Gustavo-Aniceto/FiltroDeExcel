import type { FastifyInstance, FastifyRequest } from 'fastify';
import { paginationQuerySchema } from '@excelflow/contracts';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { validate } from '../../lib/validation.js';
import * as service from './datasets.service.js';

function contextOf(request: FastifyRequest) {
  const ua = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null,
  };
}

export async function datasetRoutes(app: FastifyInstance): Promise<void> {
  // Toda rota deste modulo exige sessao valida. Planilhas trazem dados internos
  // da empresa; nenhuma pode ser acessivel sem autenticacao.
  app.addHook('preHandler', app.requireAuth);

  app.post(
    '/',
    {
      config: {
        // Limite bem mais rigido que o global: converter uma planilha ocupa CPU
        // por segundos, e um usuario nao pode monopolizar o engine com rajadas
        // de envio.
        rateLimit: { max: 20, timeWindow: '5 minutes' },
      },
    },
    async (request, reply) => {
      const file = await request.file({
        limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5 },
      });

      if (!file) {
        throw AppError.validation('Nenhum arquivo foi enviado.');
      }

      const profile = await service.uploadDataset(
        { filename: file.filename, stream: file.file },
        { userId: request.currentUser!.id, ...contextOf(request) },
      );

      return reply.code(201).send(profile);
    },
  );

  app.get('/', async (request, reply) => {
    const { page, pageSize } = validate(paginationQuerySchema, request.query);
    return reply.send(await service.listDatasets(request.currentUser!.id, page, pageSize));
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await service.getDatasetProfile(id, request.currentUser!.id));
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.deleteDataset(id, request.currentUser!.id, contextOf(request));
    return reply.code(204).send();
  });
}
