import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AccessTokenClaims, UserRole } from '@excelflow/contracts';
import { env } from '../config/env.js';

const secretKey = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'excelflow';
const AUDIENCE = 'excelflow-api';

export async function signAccessToken(user: {
  id: string;
  email: string;
  role: UserRole;
}): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${env.JWT_ACCESS_TTL}s`)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretKey, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
  return payload as unknown as AccessTokenClaims;
}

/**
 * Refresh token OPACO de 256 bits -- nao e um JWT.
 *
 * Um JWT de refresh nao pode ser revogado antes de expirar sem uma lista de
 * bloqueio, o que anula a vantagem de ser stateless. Como precisamos de
 * revogacao e deteccao de reuso, um valor aleatorio com estado no banco e mais
 * simples e mais seguro.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Somente o hash e persistido: vazar o banco nao concede sessoes. */
export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Comparacao em tempo constante, para nao vazar informacao por timing. */
export function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
