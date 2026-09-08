import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginRequestSchema, registerRequestSchema } from '@excelflow/contracts';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { validate } from '../../lib/validation.js';
import * as service from './auth.service.js';

/**
 * O cookie de refresh tem `path` restrito ao proprio endpoint de refresh.
 *
 * Consequencia pratica: ele nao acompanha nenhuma outra requisicao da
 * aplicacao. Isso reduz drasticamente a superficie de exposicao -- o token de
 * longa duracao so trafega quando e realmente necessario.
 */
const REFRESH_COOKIE = 'ef_refresh';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}

function contextOf(request: FastifyRequest): service.RequestContext {
  const ua = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null,
  };
}

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, cookieOptions());
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', async (request, reply) => {
    const input = validate(registerRequestSchema, request.body);
    const { session, refreshToken } = await service.register(input, contextOf(request));
    setRefreshCookie(reply, refreshToken);
    return reply.code(201).send(session);
  });

  app.post(
    '/login',
    {
      config: {
        // Limite bem mais rigido que o global: login e o alvo natural de
        // forca bruta e de credential stuffing.
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const input = validate(loginRequestSchema, request.body);
      const { session, refreshToken } = await service.login(input, contextOf(request));
      setRefreshCookie(reply, refreshToken);
      return reply.send(session);
    },
  );

  app.post(
    '/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const presented = request.cookies[REFRESH_COOKIE];
      if (!presented) {
        throw AppError.unauthorized('Sessao inexistente. Faca login.');
      }
      try {
        const { session, refreshToken } = await service.refresh(presented, contextOf(request));
        setRefreshCookie(reply, refreshToken);
        return reply.send(session);
      } catch (error) {
        // Sessao invalida: limpa o cookie para o navegador parar de reenviar
        // um token morto a cada tentativa.
        clearRefreshCookie(reply);
        throw error;
      }
    },
  );

  app.post('/logout', async (request, reply) => {
    await service.logout(request.cookies[REFRESH_COOKIE], contextOf(request));
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.post('/logout-all', { preHandler: app.requireAuth }, async (request, reply) => {
    await service.logoutAll(request.currentUser!.id, contextOf(request));
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = await service.getCurrentUser(request.currentUser!.id);
    return reply.send({ user });
  });
}
