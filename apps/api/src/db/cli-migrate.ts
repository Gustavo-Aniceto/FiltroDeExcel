/**
 * Cria o banco (se necessario) e aplica as migrations pendentes.
 * Uso: pnpm migrate
 */
import { ensureDatabaseExists } from './bootstrap.js';
import { closePool } from './pool.js';
import { runMigrations } from './migrator.js';

try {
  await ensureDatabaseExists();
  await runMigrations();
  await closePool();
  process.exit(0);
} catch (error) {
  console.error(`\nErro ao migrar: ${error instanceof Error ? error.message : String(error)}\n`);
  await closePool().catch(() => undefined);
  process.exit(1);
}
