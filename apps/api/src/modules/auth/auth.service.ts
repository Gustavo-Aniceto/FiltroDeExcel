import { randomUUID } from 'node:crypto';
import type {
  AuthSessionResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@excelflow/contracts';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from '../../lib/tokens.js';
import * as repo from './auth.repository.js';

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

function toPublicUser(row: repo.UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Emite o par access + refresh e persiste a sessao. */
async function issueSession(
  user: repo.UserRow,
  ctx: RequestContext,
  familyId: string = randomUUID(),
): Promise<{ session: AuthSessionResponse; refreshToken: string }> {
  const refreshToken = generateRefreshToken();

  await repo.insertRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    familyId,
    expiresAt: refreshExpiry(),
    userAgent: ctx.userAgent,
    ipAddress: ctx.ipAddress,
  });

  const accessToken = await signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    session: {
      user: toPublicUser(user),
      accessToken,
      expiresIn: env.JWT_ACCESS_TTL,
    },
    refreshToken,
  };
}

export async function register(
  input: RegisterRequest,
  ctx: RequestContext,
): Promise<{ session: AuthSessionResponse; refreshToken: string }> {
  const existing = await repo.findUserByEmail(input.email);
  if (existing) {
    // O e-mail ja estar em uso e verificavel de qualquer forma pelo fluxo de
    // login; esconder isso aqui so prejudicaria a usabilidade sem ganho real.
    throw AppError.conflict('Ja existe uma conta com este e-mail.');
  }

  // O primeiro usuario do sistema vira admin -- caso contrario nao haveria
  // como promover ninguem sem acesso direto ao banco.
  const isFirstUser = (await repo.countUsers()) === 0;

  const user = await repo.insertUser({
    email: input.email,
    passwordHash: await hashPassword(input.password),
    displayName: input.displayName,
    role: isFirstUser ? 'admin' : 'user',
  });

  await repo.writeAuditLog({
    userId: user.id,
    action: 'auth.register',
    entityType: 'user',
    entityId: user.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { role: user.role },
  });

  return issueSession(user, ctx);
}

export async function login(
  input: LoginRequest,
  ctx: RequestContext,
): Promise<{ session: AuthSessionResponse; refreshToken: string }> {
  const user = await repo.findUserByEmail(input.email);

  // Verificamos a senha mesmo quando o usuario nao existe, contra um hash
  // descartavel, para que o tempo de resposta nao revele quais e-mails estao
  // cadastrados (enumeracao de usuarios por timing).
  const digest = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(digest, input.password);

  if (!user || !passwordOk) {
    await repo.writeAuditLog({
      userId: user?.id ?? null,
      action: 'auth.login_failed',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { email: input.email },
    });
    throw AppError.unauthorized('E-mail ou senha incorretos.');
  }

  if (!user.is_active) {
    throw AppError.forbidden('Esta conta esta desativada. Procure um administrador.');
  }

  await repo.writeAuditLog({
    userId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return issueSession(user, ctx);
}

/**
 * Rotaciona o refresh token.
 *
 * Cada refresh invalida o token apresentado e emite um novo na mesma familia.
 * Se um token JA USADO for apresentado, a conclusao e que ele foi capturado
 * por terceiro -- e a familia inteira e revogada, derrubando tanto o atacante
 * quanto o usuario legitimo. Derrubar os dois e o comportamento correto: e
 * preferivel um novo login a manter uma sessao comprometida ativa.
 */
export async function refresh(
  presentedToken: string,
  ctx: RequestContext,
): Promise<{ session: AuthSessionResponse; refreshToken: string }> {
  const tokenHash = hashRefreshToken(presentedToken);
  const stored = await repo.findRefreshTokenByHash(tokenHash);

  if (!stored) {
    throw AppError.unauthorized('Sessao invalida. Faca login novamente.');
  }

  if (stored.used_at || stored.revoked_at) {
    await repo.revokeTokenFamily(stored.family_id);
    await repo.writeAuditLog({
      userId: stored.user_id,
      action: 'auth.refresh_reuse_detected',
      entityType: 'refresh_token',
      entityId: stored.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { familyId: stored.family_id },
    });
    throw AppError.unauthorized('Sessao invalidada por seguranca. Faca login novamente.');
  }

  if (stored.expires_at.getTime() <= Date.now()) {
    throw AppError.unauthorized('Sessao expirada. Faca login novamente.');
  }

  // Compare-and-swap: perde a corrida quem chegar depois.
  const claimed = await repo.markRefreshTokenUsed(stored.id);
  if (!claimed) {
    await repo.revokeTokenFamily(stored.family_id);
    throw AppError.unauthorized('Sessao invalidada por seguranca. Faca login novamente.');
  }

  const user = await repo.findUserById(stored.user_id);
  if (!user || !user.is_active) {
    throw AppError.unauthorized('Conta indisponivel.');
  }

  return issueSession(user, ctx, stored.family_id);
}

export async function logout(presentedToken: string | undefined, ctx: RequestContext): Promise<void> {
  if (!presentedToken) return;
  const stored = await repo.findRefreshTokenByHash(hashRefreshToken(presentedToken));
  if (!stored) return;

  await repo.revokeTokenFamily(stored.family_id);
  await repo.writeAuditLog({
    userId: stored.user_id,
    action: 'auth.logout',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function logoutAll(userId: string, ctx: RequestContext): Promise<void> {
  await repo.revokeAllUserTokens(userId);
  await repo.writeAuditLog({
    userId,
    action: 'auth.logout_all',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await repo.findUserById(userId);
  if (!user || !user.is_active) {
    throw AppError.unauthorized('Conta indisponivel.');
  }
  return toPublicUser(user);
}

/**
 * Hash Argon2id de uma senha aleatoria, usado apenas para gastar o mesmo tempo
 * de CPU quando o e-mail nao existe. O valor em si nunca casa com nada.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$3nRQrPmZ0KbYqPeBpqRIQIvVEjLcXRLKJnUZgSPCMxo';
