import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

/**
 * Camada de armazenamento de arquivos.
 *
 * Toda a aplicacao fala com o disco atraves daqui, e sempre com CAMINHOS
 * RELATIVOS a raiz do storage. E o que permite trocar disco local por S3 ou
 * Azure Blob depois mexendo apenas neste arquivo -- nenhum caminho absoluto
 * vaza para o banco nem para a API.
 */

export const ORIGINALS_DIR = 'originals';
export const DATASETS_DIR = 'datasets';
export const EXPORTS_DIR = 'exports';

export async function ensureStorageDirectories(): Promise<void> {
  for (const dir of [ORIGINALS_DIR, DATASETS_DIR, EXPORTS_DIR]) {
    await mkdir(join(env.storageRoot, dir), { recursive: true });
  }
}

/**
 * Resolve um caminho relativo garantindo que ele permanece dentro do storage.
 *
 * Nunca usamos o nome de arquivo enviado pelo usuario para compor caminho --
 * ele vira apenas metadado, e o caminho real deriva de um UUID. Ainda assim
 * validamos aqui, porque uma unica falha futura em outro ponto do codigo
 * viraria leitura ou escrita arbitraria no servidor.
 */
export function resolveWithinStorage(relativePath: string): string {
  const root = resolve(env.storageRoot);
  const candidate = resolve(root, relativePath);

  if (candidate !== root && !candidate.startsWith(root + '/')) {
    throw AppError.validation('Caminho de arquivo invalido.');
  }
  return candidate;
}

export interface StoredFile {
  relativePath: string;
  sizeBytes: number;
  /** SHA-256 do conteudo: identifica reenvio do mesmo arquivo. */
  contentHash: Buffer;
}

/**
 * Grava um stream no storage aplicando o limite de tamanho DURANTE a escrita.
 *
 * Checar o tamanho depois exigiria receber o arquivo inteiro primeiro -- e um
 * upload de 10 GB encheria o disco antes de ser recusado. Aqui abortamos assim
 * que o limite e ultrapassado e removemos o arquivo parcial.
 */
export async function storeStream(
  source: Readable,
  relativePath: string,
  maxBytes: number = env.MAX_UPLOAD_BYTES,
): Promise<StoredFile> {
  const absolute = resolveWithinStorage(relativePath);
  await mkdir(dirname(absolute), { recursive: true });

  const hash = createHash('sha256');
  let sizeBytes = 0;
  let exceeded = false;

  source.on('data', (chunk: Buffer) => {
    sizeBytes += chunk.length;
    if (sizeBytes > maxBytes) {
      exceeded = true;
      source.destroy(new Error('LIMITE_EXCEDIDO'));
      return;
    }
    hash.update(chunk);
  });

  try {
    await pipeline(source, createWriteStream(absolute));
  } catch (error) {
    await removeFile(relativePath);
    if (exceeded) {
      throw AppError.payloadTooLarge(
        `O arquivo excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
      );
    }
    throw error;
  }

  if (sizeBytes === 0) {
    await removeFile(relativePath);
    throw AppError.validation('O arquivo enviado esta vazio.');
  }

  return { relativePath, sizeBytes, contentHash: hash.digest() };
}

export async function removeFile(relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  try {
    await rm(resolveWithinStorage(relativePath), { force: true });
  } catch {
    // Falha ao remover nao pode derrubar a operacao principal. O job de
    // limpeza por TTL recolhe o que sobrar.
  }
}

export async function fileExists(relativePath: string | null): Promise<boolean> {
  if (!relativePath) return false;
  try {
    const info = await stat(resolveWithinStorage(relativePath));
    return info.isFile();
  } catch {
    return false;
  }
}
