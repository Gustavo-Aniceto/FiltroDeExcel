import type { FastifyBaseLogger } from 'fastify';
import { createRequest, sql } from '../../db/pool.js';
import { removeFile } from '../../lib/storage.js';

/**
 * Retencao automatica de arquivos.
 *
 * Planilhas trazem dados internos da empresa. Mante-las no servidor para sempre
 * transforma um incidente futuro num vazamento muito maior do que precisaria
 * ser. Passado o TTL, os ARQUIVOS sao apagados.
 *
 * O REGISTRO permanece, com status 'expired': o historico de processamentos
 * precisa continuar dizendo "em 08/09 rodamos a regra X sobre base.xlsx e o
 * resultado foi 1.482 registros", mesmo que o arquivo em si ja nao exista.
 * Apagar a linha destruiria a trilha de auditoria junto com o dado.
 */

interface ExpiredRow {
  id: string;
  original_path: string | null;
  parquet_path: string | null;
}

/** Teto por execucao: evita uma varredura longa segurando conexoes do pool. */
const BATCH_SIZE = 200;

export async function purgeExpiredDatasets(logger: FastifyBaseLogger): Promise<number> {
  const request = await createRequest();
  const result = await request
    .input('limit', sql.Int, BATCH_SIZE)
    .query<ExpiredRow>(
      `SELECT TOP (@limit) id, original_path, parquet_path
         FROM dbo.datasets
        WHERE expires_at IS NOT NULL
          AND expires_at <= SYSUTCDATETIME()
          AND status <> 'expired'`,
    );

  if (result.recordset.length === 0) return 0;

  for (const row of result.recordset) {
    await removeFile(row.original_path);
    await removeFile(row.parquet_path);

    // Marcamos como expirado DEPOIS de apagar os arquivos. Na ordem inversa,
    // uma falha entre as duas etapas deixaria arquivos orfaos no disco que
    // nenhuma execucao futura tentaria remover.
    const update = await createRequest();
    await update
      .input('id', sql.UniqueIdentifier, row.id)
      .query(
        `UPDATE dbo.datasets
            SET status = 'expired', original_path = NULL, parquet_path = NULL
          WHERE id = @id`,
      );
  }

  logger.info(`Retencao: ${result.recordset.length} dataset(s) expirado(s) e removido(s).`);
  return result.recordset.length;
}

/**
 * Agenda a limpeza periodica e devolve a funcao de parada.
 *
 * `unref()` faz o timer NAO impedir o encerramento do processo -- sem isso, um
 * deploy ficaria esperando o proximo tick antes de terminar.
 */
export function scheduleRetention(
  logger: FastifyBaseLogger,
  intervalMs = 60 * 60 * 1000,
): () => void {
  let running = false;

  const tick = async () => {
    // Uma execucao lenta nao pode se sobrepor a proxima: duas varreduras
    // simultaneas tentariam apagar os mesmos arquivos.
    if (running) return;
    running = true;
    try {
      await purgeExpiredDatasets(logger);
    } catch (error) {
      // Falha na limpeza nunca derruba a API: e manutencao, nao caminho critico.
      logger.error({ err: error }, 'Falha na rotina de retencao');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();

  // Primeira passada logo apos o boot recolhe o que expirou enquanto o servico
  // esteve fora do ar.
  setTimeout(() => void tick(), 10_000).unref();

  return () => clearInterval(timer);
}
