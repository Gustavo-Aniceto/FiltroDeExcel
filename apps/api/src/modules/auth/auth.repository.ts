import type { UserRole } from '@excelflow/contracts';
import { createRequest, sql } from '../../db/pool.js';

/**
 * Camada de acesso a dados da autenticacao.
 *
 * TODO parametro passa por `.input()` com tipo explicito. Nunca ha
 * interpolacao de string em SQL neste arquivo -- nem deve haver em nenhum
 * outro repositorio.
 */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  used_at: Date | null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const request = await createRequest();
  const result = await request
    .input('email', sql.NVarChar(320), email)
    .query<UserRow>(
      `SELECT id, email, password_hash, display_name, role, is_active, created_at
         FROM dbo.users
        WHERE email = @email`,
    );
  return result.recordset[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const request = await createRequest();
  const result = await request
    .input('id', sql.UniqueIdentifier, id)
    .query<UserRow>(
      `SELECT id, email, password_hash, display_name, role, is_active, created_at
         FROM dbo.users
        WHERE id = @id`,
    );
  return result.recordset[0] ?? null;
}

export async function countUsers(): Promise<number> {
  const request = await createRequest();
  const result = await request.query<{ total: number }>('SELECT COUNT(*) AS total FROM dbo.users');
  return result.recordset[0]?.total ?? 0;
}

export async function insertUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
}): Promise<UserRow> {
  const request = await createRequest();
  const result = await request
    .input('email', sql.NVarChar(320), input.email)
    .input('passwordHash', sql.NVarChar(255), input.passwordHash)
    .input('displayName', sql.NVarChar(120), input.displayName)
    .input('role', sql.VarChar(20), input.role)
    .query<UserRow>(
      `INSERT INTO dbo.users (email, password_hash, display_name, role)
       OUTPUT inserted.id, inserted.email, inserted.password_hash,
              inserted.display_name, inserted.role, inserted.is_active, inserted.created_at
       VALUES (@email, @passwordHash, @displayName, @role)`,
    );
  const row = result.recordset[0];
  if (!row) throw new Error('Falha ao inserir usuario');
  return row;
}

export async function insertRefreshToken(input: {
  userId: string;
  tokenHash: Buffer;
  familyId: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}): Promise<string> {
  const request = await createRequest();
  const result = await request
    .input('userId', sql.UniqueIdentifier, input.userId)
    .input('tokenHash', sql.Binary, input.tokenHash)
    .input('familyId', sql.UniqueIdentifier, input.familyId)
    .input('expiresAt', sql.DateTime2(3), input.expiresAt)
    .input('userAgent', sql.NVarChar(400), input.userAgent)
    .input('ipAddress', sql.VarChar(45), input.ipAddress)
    .query<{ id: string }>(
      `INSERT INTO dbo.refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
       OUTPUT inserted.id
       VALUES (@userId, @tokenHash, @familyId, @expiresAt, @userAgent, @ipAddress)`,
    );
  const row = result.recordset[0];
  if (!row) throw new Error('Falha ao registrar sessao');
  return row.id;
}

export async function findRefreshTokenByHash(tokenHash: Buffer): Promise<RefreshTokenRow | null> {
  const request = await createRequest();
  const result = await request
    .input('tokenHash', sql.Binary, tokenHash)
    .query<RefreshTokenRow>(
      `SELECT id, user_id, family_id, expires_at, revoked_at, used_at
         FROM dbo.refresh_tokens
        WHERE token_hash = @tokenHash`,
    );
  return result.recordset[0] ?? null;
}

/**
 * Marca o token como usado e revogado numa unica instrucao condicional.
 *
 * O `WHERE used_at IS NULL` transforma isto num compare-and-swap atomico: se
 * duas requisicoes de refresh chegarem ao mesmo tempo com o mesmo token,
 * apenas uma afeta uma linha. A outra recebe 0 e e tratada como reuso. Sem
 * essa condicao, haveria uma janela de corrida em que os dois lados receberiam
 * sessoes validas.
 */
export async function markRefreshTokenUsed(id: string): Promise<boolean> {
  const request = await createRequest();
  const result = await request
    .input('id', sql.UniqueIdentifier, id)
    .query(
      `UPDATE dbo.refresh_tokens
          SET used_at = SYSUTCDATETIME(), revoked_at = SYSUTCDATETIME()
        WHERE id = @id AND used_at IS NULL AND revoked_at IS NULL`,
    );
  return result.rowsAffected[0] === 1;
}

/** Revoga a familia inteira: resposta a suspeita de token roubado. */
export async function revokeTokenFamily(familyId: string): Promise<void> {
  const request = await createRequest();
  await request
    .input('familyId', sql.UniqueIdentifier, familyId)
    .query(
      `UPDATE dbo.refresh_tokens
          SET revoked_at = SYSUTCDATETIME()
        WHERE family_id = @familyId AND revoked_at IS NULL`,
    );
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  const request = await createRequest();
  await request
    .input('userId', sql.UniqueIdentifier, userId)
    .query(
      `UPDATE dbo.refresh_tokens
          SET revoked_at = SYSUTCDATETIME()
        WHERE user_id = @userId AND revoked_at IS NULL`,
    );
}

export async function writeAuditLog(input: {
  userId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const request = await createRequest();
  await request
    .input('userId', sql.UniqueIdentifier, input.userId)
    .input('action', sql.VarChar(60), input.action)
    .input('entityType', sql.VarChar(40), input.entityType ?? null)
    .input('entityId', sql.NVarChar(100), input.entityId ?? null)
    .input('ipAddress', sql.VarChar(45), input.ipAddress ?? null)
    .input('userAgent', sql.NVarChar(400), input.userAgent ?? null)
    .input('metadata', sql.NVarChar(sql.MAX), input.metadata ? JSON.stringify(input.metadata) : null)
    .query(
      `INSERT INTO dbo.audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, metadata)
       VALUES (@userId, @action, @entityType, @entityId, @ipAddress, @userAgent, @metadata)`,
    );
}
