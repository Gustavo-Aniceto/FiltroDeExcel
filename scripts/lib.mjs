/**
 * Utilitarios compartilhados pelos scripts de setup e desenvolvimento.
 *
 * Escritos em Node, e nao em shell, por um motivo pratico: o sistema sera usado
 * por gente que trabalha com Excel, e boa parte dessas maquinas roda Windows.
 * Um script .sh simplesmente nao executa la. Node ja e pre-requisito do
 * projeto, entao usa-lo como linguagem de automacao nao adiciona dependencia.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const IS_WINDOWS = process.platform === 'win32';

const ESC = '\u001b';
const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code) => (text) =>
  supportsColor ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const color = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  magenta: paint('35'),
  cyan: paint('36'),
};

export function step(message) {
  console.log(`\n${color.bold(color.blue('>'))} ${color.bold(message)}`);
}

export function ok(message) {
  console.log(`  ${color.green('OK')}  ${message}`);
}

export function warn(message) {
  console.log(`  ${color.yellow('!')}   ${message}`);
}

export function fail(message, hint) {
  console.error(`\n${color.red('ERRO')} ${color.bold(message)}`);
  if (hint) console.error(`     ${color.dim(hint)}\n`);
  process.exit(1);
}

/**
 * Executa um comando.
 *
 * No Windows, `pnpm` e `npx` sao arquivos .cmd, e o `spawn` do Node nao os
 * executa sem `shell: true`. Sem esse tratamento os scripts falhariam com
 * ENOENT apenas no Windows -- justamente onde seria mais dificil depurar.
 */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      stdio: options.silent ? 'pipe' : 'inherit',
      shell: IS_WINDOWS,
      env: { ...process.env, ...options.env },
    });

    let output = '';
    if (options.silent) {
      child.stdout?.on('data', (chunk) => (output += chunk));
      child.stderr?.on('data', (chunk) => (output += chunk));
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(options.silent ? output : `"${command}" saiu com codigo ${code}`));
    });
  });
}

/** Verifica se um executavel existe, sem derrubar o script caso nao exista. */
export async function has(command, args = ['--version']) {
  try {
    await run(command, args, { silent: true });
    return true;
  } catch {
    return false;
  }
}

/** Caminho do Python dentro da venv -- difere entre Windows e Unix. */
export function venvPython() {
  return IS_WINDOWS
    ? join(ROOT, 'services', 'engine', '.venv', 'Scripts', 'python.exe')
    : join(ROOT, 'services', 'engine', '.venv', 'bin', 'python');
}

export function venvExists() {
  return existsSync(venvPython());
}

/** Primeiro comando Python disponivel na maquina. */
export async function findPython() {
  for (const candidate of IS_WINDOWS ? ['py', 'python', 'python3'] : ['python3', 'python']) {
    if (await has(candidate, ['--version'])) return candidate;
  }
  return null;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
