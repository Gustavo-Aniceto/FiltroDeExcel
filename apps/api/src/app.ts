import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { datasetRoutes } from './modules/datasets/datasets.routes.js';
import { queryRoutes } from './modules/datasets/query.routes.js';
import { recipeRoutes } from './modules/recipes/recipes.routes.js';
import { aiRoutes } from './modules/ai/ai.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';

export const API_PREFIX = '/api/v1';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.isProduction ? 'info' : 'debug',
      // Logs legiveis no terminal em desenvolvimento; JSON estruturado em
      // producao, para o agregador de logs conseguir indexar.
      ...(env.isDevelopment
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
      redact: {
        // Nunca registrar credenciais nem tokens no log. Um log e copiado,
        // enviado por e-mail e indexado -- e o lugar mais facil de vazar
        // segredo sem perceber.
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
        ],
        remove: true,
      },
    },
    // Limite de corpo para JSON. Uploads usam streaming e tem limite proprio.
    bodyLimit: 1_048_576,
    trustProxy: true,
    // O requestId aparece em toda resposta de erro: liga a reclamacao do
    // usuario a linha exata do log.
    genReqId: () => `req-${Math.random().toString(36).slice(2, 10)}`,
  });

  await registerSecurity(app);

  // Uploads sao consumidos como STREAM (`attachFieldsToBody` fica desligado):
  // bufferizar uma planilha de 100 MB na memoria do processo derrubaria a API
  // com poucos envios simultaneos.
  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_UPLOAD_BYTES,
      files: 1,
      fieldSize: 1_048_576,
    },
  });

  registerAuth(app);
  registerErrorHandler(app);

  await app.register(healthRoutes, { prefix: `${API_PREFIX}/health` });
  await app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
  await app.register(datasetRoutes, { prefix: `${API_PREFIX}/datasets` });
  // queryRoutes monta caminhos proprios (/datasets/:id/preview, /exports/...,
  // /executions), entao recebe apenas o prefixo da versao.
  await app.register(queryRoutes, { prefix: API_PREFIX });
  await app.register(recipeRoutes, { prefix: `${API_PREFIX}/recipes` });
  await app.register(aiRoutes, { prefix: `${API_PREFIX}/ai` });

  return app;
}
