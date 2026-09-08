import type { FastifyInstance } from 'fastify';
import { getPool } from '../../db/pool.js';

/**
 * Liveness x readiness sao coisas diferentes e precisam de rotas diferentes.
 *
 * `/health`  -> "o processo esta vivo?" Se falhar, reinicie o container.
 * `/health/ready` -> "consigo atender requisicoes?" Se falhar, tire do
 *                    balanceador, mas NAO reinicie: o banco e que esta fora, e
 *                    reiniciar a API nao resolve nada.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({
    status: 'ok',
    service: 'excelflow-api',
    timestamp: new Date().toISOString(),
  }));

  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
      checks.database = { ok: true };
    } catch (error) {
      checks.database = {
        ok: false,
        detail: error instanceof Error ? error.message : 'erro desconhecido',
      };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}
