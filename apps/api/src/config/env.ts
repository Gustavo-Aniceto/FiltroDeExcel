import { config as loadDotenv } from 'dotenv';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// apps/api/src/config/env.ts -> config -> src -> api -> apps -> raiz
const MONOREPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../..');

// O .env vive na raiz do monorepo: um unico arquivo configura API, engine e web.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv();

/**
 * Booleano lido de variavel de ambiente.
 *
 * `z.coerce.boolean()` NAO serve aqui: ele aplica `Boolean(valor)`, e
 * `Boolean("false")` e `true` -- toda string nao vazia e verdadeira em
 * JavaScript. Na pratica isso tornaria impossivel DESLIGAR uma flag pelo .env:
 * `COOKIE_SECURE=false` ligaria o cookie seguro em HTTP e derrubaria o login
 * silenciosamente.
 *
 * Aqui interpretamos o TEXTO, e recusamos valores ambiguos em vez de adivinhar.
 */
const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['true', '1', 'yes', 'on'].includes(value),
  );

/**
 * Validacao de ambiente com falha imediata.
 *
 * Um servico que sobe com JWT_SECRET indefinido e pior do que um que nao sobe:
 * ele aceita requisicoes e falha de forma silenciosa e imprevisivel. Aqui o
 * processo morre no boot, com uma mensagem que diz exatamente o que falta.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(1433),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_ENCRYPT: booleanFromEnv.default(true),
  DB_TRUST_SERVER_CERTIFICATE: booleanFromEnv.default(true),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(0),

  // 32 bytes e o minimo defensavel para HS256. Bloqueamos o placeholder do
  // .env.example para que ele nunca chegue a producao por descuido.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres'),
  JWT_ACCESS_TTL: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(14),
  COOKIE_SECURE: booleanFromEnv.default(false),

  ENGINE_URL: z.string().url().default('http://localhost:8000'),
  ENGINE_SHARED_SECRET: z.string().min(16),

  /**
   * Aplica as migrations pendentes no boot.
   *
   * Em desenvolvimento vem ligado por conveniencia. Em producao o padrao e
   * DESLIGADO de proposito: varias instancias subindo ao mesmo tempo
   * aplicariam DDL concorrentemente, e migration deve ser um passo deliberado
   * do deploy. O container de teste local liga explicitamente.
   */
  MIGRATE_ON_BOOT: booleanFromEnv.optional(),

  STORAGE_ROOT: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(104_857_600),
  DATASET_TTL_HOURS: z.coerce.number().int().min(1).default(72),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`\nConfiguracao invalida. Verifique o arquivo .env:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

const PLACEHOLDER_SECRETS = [
  'troque-este-segredo-de-desenvolvimento-por-um-aleatorio-de-48-bytes',
  'troque-este-segredo-interno-de-desenvolvimento',
];

if (raw.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (PLACEHOLDER_SECRETS.includes(raw.JWT_SECRET)) {
    problems.push('JWT_SECRET ainda e o valor de exemplo');
  }
  if (PLACEHOLDER_SECRETS.includes(raw.ENGINE_SHARED_SECRET)) {
    problems.push('ENGINE_SHARED_SECRET ainda e o valor de exemplo');
  }
  if (!raw.COOKIE_SECURE) {
    problems.push('COOKIE_SECURE deve ser true em producao (cookies exigem HTTPS)');
  }
  if (raw.DB_TRUST_SERVER_CERTIFICATE) {
    problems.push('DB_TRUST_SERVER_CERTIFICATE nao deve ser true em producao');
  }
  if (problems.length > 0) {
    console.error(`\nConfiguracao insegura para producao:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exit(1);
  }
}

export const env = {
  ...raw,
  migrateOnBoot: raw.MIGRATE_ON_BOOT ?? raw.NODE_ENV !== 'production',
  /**
   * Caminho relativo e resolvido a partir da RAIZ do monorepo, nao do cwd do
   * processo. Sem isso, `STORAGE_ROOT=./storage` viraria `apps/api/storage` na
   * API e `services/engine/storage` no engine: a API gravaria o upload num
   * diretorio e o engine procuraria em outro.
   */
  storageRoot: isAbsolute(raw.STORAGE_ROOT)
    ? raw.STORAGE_ROOT
    : resolve(MONOREPO_ROOT, raw.STORAGE_ROOT),
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
