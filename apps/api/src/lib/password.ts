import { hash, verify } from '@node-rs/argon2';

/**
 * Parametros Argon2id conforme as recomendacoes do OWASP Password Storage
 * Cheat Sheet: 19 MiB de memoria, 2 iteracoes, paralelismo 1.
 *
 * Argon2id (e nao bcrypt) porque resiste tanto a ataque por GPU quanto a
 * side-channel. O custo de memoria e o que encarece o ataque em hardware
 * dedicado -- e o parametro que realmente importa.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    // Hash corrompido ou em formato desconhecido. Trata como senha incorreta
    // em vez de estourar 500 -- e nao revela ao cliente que o hash e invalido.
    return false;
  }
}
