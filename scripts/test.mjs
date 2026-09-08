/**
 * Roda a bateria de testes dos tres pacotes.
 *
 * Um comando so: `pnpm test`. Sem isto seriam tres invocacoes diferentes, uma
 * delas com o caminho do Python da venv, que muda entre Windows e Unix.
 */
import { color, run, venvExists, venvPython, ROOT, step, ok, fail } from './lib.mjs';
import { join } from 'node:path';

let failures = 0;

async function suite(name, command, args, options = {}) {
  step(name);
  try {
    await run(command, args, options);
    ok(`${name}: passou`);
  } catch {
    console.error(`  ${color.red('FALHOU')}  ${name}`);
    failures += 1;
  }
}

await suite('Contratos (motor de regras)', 'pnpm', ['--filter', '@excelflow/contracts', 'test']);
await suite('API (conversao do assistente)', 'pnpm', ['--filter', '@excelflow/api', 'test']);

if (venvExists()) {
  await suite(
    'Motor de processamento (inferencia, compilador, execucao)',
    venvPython(),
    ['-m', 'pytest', '-q'],
    {
      cwd: join(ROOT, 'services', 'engine'),
      env: { ENGINE_SHARED_SECRET: 'segredo-de-teste-com-tamanho-suficiente' },
    },
  );
} else {
  console.log(`\n  ${color.yellow('!')}   Motor Python nao preparado. Rode "pnpm bootstrap" para incluir seus testes.`);
}

if (failures > 0) {
  fail(`${failures} suite(s) de teste falharam.`);
}

console.log(`\n${color.green(color.bold('Todos os testes passaram.'))}\n`);
