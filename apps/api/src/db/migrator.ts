import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getPool, sql } from './pool.js';

/**
 * Runner de migrations minimalista, sem dependencia externa.
 *
 * Regras:
 *   1. Arquivos .sql sao aplicados em ordem alfabetica (0001_, 0002_, ...).
 *   2. Cada arquivo roda uma unica vez, dentro de uma transacao.
 *   3. Um checksum detecta se um arquivo JA APLICADO foi editado depois --
 *      erro comum que faz o esquema divergir silenciosamente entre ambientes.
 *
 * Migrations sao imutaveis: para mudar algo, crie um arquivo novo.
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const CREATE_HISTORY_TABLE = `
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'schema_migrations' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.schema_migrations (
        name        NVARCHAR(255) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
        checksum    CHAR(64)      NOT NULL,
        applied_at  DATETIME2(3)  NOT NULL CONSTRAINT DF_schema_migrations_applied DEFAULT SYSUTCDATETIME()
    );
END`;

export interface MigrationLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const consoleLogger: MigrationLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

/**
 * O driver TDS nao aceita multiplos lotes numa unica chamada quando ha
 * comandos que exigem estar sozinhos no lote. Dividimos por GO, como o SSMS.
 */
function splitBatches(script: string): string[] {
  return script
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter((batch) => batch.length > 0);
}

export async function runMigrations(logger: MigrationLogger = consoleLogger): Promise<void> {
  const pool = await getPool();
  await pool.request().batch(CREATE_HISTORY_TABLE);

  const applied = await pool
    .request()
    .query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM dbo.schema_migrations',
    );
  const appliedMap = new Map(applied.recordset.map((r) => [r.name, r.checksum]));

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;

  for (const file of files) {
    const content = await readFile(join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(content).digest('hex');
    const previous = appliedMap.get(file);

    if (previous) {
      if (previous !== checksum) {
        logger.warn(
          `A migration "${file}" ja foi aplicada, mas seu conteudo mudou. ` +
            'Migrations sao imutaveis: crie um novo arquivo em vez de editar este.',
        );
      }
      continue;
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const batch of splitBatches(content)) {
        await new sql.Request(transaction).batch(batch);
      }
      await new sql.Request(transaction)
        .input('name', sql.NVarChar(255), file)
        .input('checksum', sql.Char(64), checksum)
        .query('INSERT INTO dbo.schema_migrations (name, checksum) VALUES (@name, @checksum)');
      await transaction.commit();
      logger.info(`Migration aplicada: ${file}`);
      count += 1;
    } catch (error) {
      await transaction.rollback();
      throw new Error(
        `Falha na migration "${file}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  logger.info(
    count === 0 ? 'Banco de dados ja esta atualizado.' : `${count} migration(s) aplicada(s).`,
  );
}
