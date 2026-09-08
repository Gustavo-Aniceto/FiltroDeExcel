import type { ColumnProfile } from '@excelflow/contracts';
import { AppError } from '../../lib/errors.js';
import type { EngineColumnRef } from '../../lib/engine-client.js';
import * as repo from './datasets.repository.js';

/**
 * Contexto de um dataset pronto para consulta.
 *
 * Toda operacao sobre dados (previa, analises, execucao, exportacao) precisa
 * exatamente da mesma coisa: confirmar que o dataset e do usuario, que esta
 * pronto, e carregar o esquema das colunas. Centralizar aqui evita que uma
 * dessas verificacoes seja esquecida num endpoint novo -- e a verificacao de
 * dono e o que impede acesso a planilha alheia.
 */
export interface DatasetContext {
  datasetId: string;
  parquetPath: string;
  originalFilename: string;
  rowCount: number;
  columns: ColumnProfile[];
  engineColumns: EngineColumnRef[];
}

export async function loadDatasetContext(
  datasetId: string,
  userId: string,
): Promise<DatasetContext> {
  const dataset = await repo.findDatasetById(datasetId, userId);
  if (!dataset) {
    // 404, e nao 403: confirmar que o recurso existe ja seria vazamento.
    throw AppError.notFound('Planilha nao encontrada.');
  }

  if (dataset.status === 'expired' || !dataset.parquet_path) {
    throw new AppError(
      'NOT_FOUND',
      'Os dados desta planilha nao estao mais disponiveis. Envie o arquivo novamente.',
      410,
    );
  }

  if (dataset.status === 'failed') {
    throw AppError.validation(
      dataset.error_message ?? 'Esta planilha nao pode ser processada.',
    );
  }

  if (dataset.status !== 'ready') {
    throw AppError.validation('Esta planilha ainda esta sendo processada.');
  }

  const columns = await repo.findDatasetColumns(datasetId);
  if (columns.length === 0) {
    throw AppError.validation('O perfil desta planilha nao esta disponivel.');
  }

  return {
    datasetId: dataset.id,
    parquetPath: dataset.parquet_path,
    originalFilename: dataset.original_filename,
    rowCount: dataset.row_count,
    columns,
    // O esquema segue junto em cada chamada ao engine: ele nao tem credencial
    // de banco e nao consulta o SQL Server. E o que mantem o servico que
    // interpreta arquivos nao confiaveis isolado do plano de controle.
    engineColumns: columns.map((column) => ({ name: column.name, type: column.type })),
  };
}
