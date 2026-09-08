import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    // A API so devolve JSON e downloads; nao renderiza HTML. Uma CSP restritiva
    // aqui e barata e protege paginas de erro geradas pelo framework.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    // Lista explicita de origens, nunca reflexo automatico da origem recebida:
    // com `credentials: true`, refletir a origem equivale a desligar o CORS.
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // curl, health checks
      callback(null, env.corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });

  await app.register(cookie, {
    secret: env.JWT_SECRET,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE,
      path: '/',
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // A chave e o usuario autenticado quando ha um; senao, o IP. Sem isso,
    // todos atras de um mesmo NAT corporativo compartilhariam a mesma cota.
    keyGenerator: (request) => request.currentUser?.id ?? request.ip,
  });
}
