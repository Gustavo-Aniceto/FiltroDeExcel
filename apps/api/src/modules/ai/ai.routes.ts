import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validation.js';
import { interpret, isAiEnabled } from './ai.service.js';

const interpretSchema = z.object({
  prompt: z.string().trim().min(3, 'Descreva o que voce quer').max(1000),
});

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /**
   * A interface consulta isto para decidir se mostra o assistente.
   *
   * O recurso e opcional: sem ANTHROPIC_API_KEY o sistema inteiro continua
   * funcionando, e o campo simplesmente nao aparece -- melhor do que oferecer
   * algo que devolve erro ao ser usado.
   */
  app.get('/status', async (_request, reply) => reply.send({ enabled: isAiEnabled() }));

  app.post(
    '/datasets/:id/interpret',
    {
      // Cada chamada custa dinheiro numa API externa. O limite protege a conta
      // tanto de um laco acidental na interface quanto de abuso deliberado.
      config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { prompt } = validate(interpretSchema, request.body);
      const ua = request.headers['user-agent'];

      const result = await interpret(id, prompt, {
        userId: request.currentUser!.id,
        ipAddress: request.ip ?? null,
        userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null,
      });

      return reply.send(result);
    },
  );
}
