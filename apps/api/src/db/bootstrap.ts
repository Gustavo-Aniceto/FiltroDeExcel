import sql from 'mssql';
import { env } from '../config/env.js';

/**
 * Garante que o banco de dados da aplicacao exista.
 *
 * O pool principal conecta direto em `excelflow`, o que falha num servidor
 * recem-criado. Aqui abrimos uma conexao efemera em `master` apenas para criar
 * o banco, e a fechamos em seguida.
 *
 * `CREATE DATABASE` nao aceita parametro para o nome nem roda dentro de
 * transacao, entao a interpolacao e inevitavel. Duas protecoes: o nome e
 * validado contra uma lista de caracteres seguros ANTES de chegar ao SQL, e
 * passa por QUOTENAME, que faz o escape correto de identificador. O valor vem
 * de variavel de ambiente do operador, nao de entrada de usuario.
 */
const SAFE_DB_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export async function ensureDatabaseExists(
  log: (message: string) => void = console.log,
): Promise<void> {
  if (!SAFE_DB_NAME.test(env.DB_NAME)) {
    throw new Error(
      `DB_NAME invalido: "${env.DB_NAME}". Use apenas letras, numeros e underscore, comecando por letra.`,
    );
  }

  const admin = new sql.ConnectionPool({
    server: env.DB_HOST,
    port: env.DB_PORT,
    database: 'master',
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: {
      encrypt: env.DB_ENCRYPT,
      trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
      enableArithAbort: true,
    },
    connectionTimeout: 15_000,
  });

  await admin.connect();
  try {
    const existing = await admin
      .request()
      .input('name', sql.NVarChar(128), env.DB_NAME)
      .query<{ name: string }>('SELECT name FROM sys.databases WHERE name = @name');

    if (existing.recordset.length > 0) return;

    await admin.request().batch(
      `DECLARE @sql NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(N'${env.DB_NAME}');
       EXEC sp_executesql @sql;`,
    );
    log(`Banco de dados "${env.DB_NAME}" criado.`);
  } finally {
    await admin.close();
  }
}
