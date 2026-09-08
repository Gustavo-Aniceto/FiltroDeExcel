import sql from 'mssql';
import { env } from '../config/env.js';

/**
 * Pool unico de conexoes, compartilhado pelo processo.
 *
 * `mssql` ja gerencia o pool internamente; abrir mais de um por processo
 * apenas multiplica conexoes ociosas no servidor.
 */
let pool: sql.ConnectionPool | null = null;
let connecting: Promise<sql.ConnectionPool> | null = null;

const poolConfig: sql.config = {
  server: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  options: {
    encrypt: env.DB_ENCRYPT,
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
    // Sem isto, DATETIME2 volta como Date no fuso local do processo e
    // "2026-09-08 00:30 UTC" pode virar "07/09/2026" no relatorio.
    useUTC: true,
    enableArithAbort: true,
  },
  pool: {
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    idleTimeoutMillis: 30_000,
  },
  requestTimeout: 30_000,
  connectionTimeout: 15_000,
};

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  // Requisicoes concorrentes durante o boot devem compartilhar a MESMA
  // promessa de conexao, em vez de cada uma abrir seu proprio pool.
  if (connecting) return connecting;

  connecting = new sql.ConnectionPool(poolConfig)
    .connect()
    .then((connected) => {
      pool = connected;
      connecting = null;
      return connected;
    })
    .catch((error) => {
      connecting = null;
      throw error;
    });

  return connecting;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

/** Nova request vinculada ao pool. Sempre use `.input()` para valores. */
export async function createRequest(): Promise<sql.Request> {
  const connection = await getPool();
  return connection.request();
}

export { sql };
