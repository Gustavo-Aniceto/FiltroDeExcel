import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@excelflow/contracts';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
  }
  interface FastifyInstance {
    /** PreHandler: exige autenticacao. Rejeita com 401 se ausente ou invalida. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** PreHandler: exige um dos papeis informados. Use apos requireAuth. */
    requireRole: (
      ...roles: UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

export function registerAuth(app: FastifyInstance): void {
  /**
   * Decora `request.currentUser` quando ha um token valido, SEM rejeitar
   * quando nao ha. Assim o rate limiter consegue usar a identidade tambem em
   * rotas publicas, e as rotas escolhem se exigem ou nao autenticacao.
   */
  app.addHook('onRequest', async (request) => {
    const token = extractBearer(request.headers.authorization);
    if (!token) return;
    try {
      const claims = await verifyAccessToken(token);
      request.currentUser = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
      };
    } catch {
      // Token invalido ou expirado nao e erro aqui: a rota decide. Um token
      // expirado numa rota publica deve simplesmente ser ignorado.
    }
  });

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    if (!request.currentUser) {
      throw AppError.unauthorized('Sessao expirada ou inexistente. Faca login novamente.');
    }
  });

  app.decorate(
    'requireRole',
    (...roles: UserRole[]) =>
      async (request: FastifyRequest) => {
        if (!request.currentUser) {
          throw AppError.unauthorized();
        }
        if (!roles.includes(request.currentUser.role)) {
          throw AppError.forbidden('Voce nao tem permissao para esta operacao.');
        }
      },
  );
}
