import { env } from './config/env.js';
import { buildApp } from './app.js';
import { closePool, getPool } from './db/pool.js';
import { runMigrations } from './db/migrator.js';
import { ensureDatabaseExists } from './db/bootstrap.js';
import { ensureStorageDirectories } from './lib/storage.js';
import { scheduleRetention } from './modules/datasets/retention.js';

const app = await buildApp();

try {
  await ensureStorageDirectories();

  // Em desenvolvimento, criar o banco no boot elimina um passo manual que
  // todo mundo esquece na primeira execucao.
  if (env.migrateOnBoot) {
    await ensureDatabaseExists((m) => app.log.info(m));
  }

  await getPool();
  app.log.info('Conectado ao SQL Server.');

  // Migrar no boot elimina um passo manual esquecido em desenvolvimento e no
  // container de teste. Em producao e desligado por padrao: aplicar DDL
  // automaticamente em varias instancias subindo ao mesmo tempo e receita de
  // corrida e de indisponibilidade.
  if (env.migrateOnBoot) {
    await runMigrations({
      info: (m) => app.log.info(m),
      warn: (m) => app.log.warn(m),
    });
  }
} catch (error) {
  app.log.error(
    { err: error },
    'Nao foi possivel conectar ao banco. Verifique se o SQL Server esta no ar (pnpm infra:up).',
  );
  process.exit(1);
}

const stopRetention = scheduleRetention(app.log);

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(`API disponivel em http://localhost:${env.API_PORT}/api/v1`);
} catch (error) {
  app.log.error({ err: error }, 'Falha ao iniciar o servidor');
  process.exit(1);
}

/**
 * Encerramento gracioso: para de aceitar conexoes novas, deixa as em curso
 * terminarem e so entao fecha o pool. Sem isso, um deploy derruba requisicoes
 * no meio e pode deixar transacoes abertas.
 */
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Recebido ${signal}, encerrando...`);
    try {
      stopRetention();
      await app.close();
      await closePool();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Erro no encerramento');
      process.exit(1);
    }
  });
}
