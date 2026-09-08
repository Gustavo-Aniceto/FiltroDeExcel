/**
 * Sobe os tres servicos do ExcelFlow de uma vez:
 *
 *   pnpm dev
 *
 * Sem este script seriam tres terminais abertos em paralelo -- e esquecer um
 * deles produz falhas confusas ("o upload some", "nao conecta"). Aqui a saida
 * dos tres aparece junta, prefixada, e Ctrl+C derruba todos.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IS_WINDOWS, ROOT, color, has, run, venvExists, venvPython } from './lib.mjs';

/**
 * Ambiente nao preparado? Preparamos, em vez de mandar rodar outro comando.
 *
 * Ha um unico comando para lembrar -- `pnpm dev` --, e a primeira execucao
 * simplesmente demora mais. Exigir um `pnpm bootstrap` previo so cria a chance
 * de esquece-lo e receber um erro de conexao que nao explica nada.
 */
const needsBootstrap =
  !existsSync(join(ROOT, '.env')) ||
  !venvExists() ||
  !existsSync(join(ROOT, 'packages', 'contracts', 'dist'));

if (needsBootstrap) {
  console.log(color.dim('Primeira execucao: preparando o ambiente...\n'));
  try {
    await run('node', [join(ROOT, 'scripts', 'setup.mjs')]);
  } catch {
    process.exit(1);
  }
}

// O SQL Server e a unica dependencia externa. Subir sem ele produz uma pilha de
// erros de conexao que nao dizem qual e o problema real.
if (process.env.SKIP_DOCKER !== '1' && (await has('docker', ['info', '--format', '{{.ServerVersion}}']))) {
  try {
    const running = await run(
      'docker',
      ['ps', '--filter', 'name=excelflow-sqlserver', '--format', '{{.Names}}'],
      { silent: true },
    );
    if (!running.includes('excelflow-sqlserver')) {
      console.log(color.dim('Subindo o SQL Server...'));
      await run('docker', ['compose', 'up', '-d', 'sqlserver'], { silent: true });
    }
  } catch {
    console.log(color.yellow('Nao foi possivel verificar o SQL Server; seguindo mesmo assim.'));
  }
}

/**
 * Uma execucao anterior que nao encerrou direito deixa as portas ocupadas, e o
 * erro nativo ("EADDRINUSE") nao diz o que fazer. Verificamos antes de subir e
 * damos a instrucao concreta.
 */
async function checkPort(port, label) {
  const { createServer } = await import('node:net');
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

const PORTS = [
  [5173, 'frontend'],
  [3333, 'API'],
  [8000, 'motor de processamento'],
];

const busy = [];
for (const [port, label] of PORTS) {
  if (!(await checkPort(port, label))) busy.push(`${port} (${label})`);
}

if (busy.length > 0) {
  console.error(`
${color.red('ERRO')} ${color.bold('Estas portas ja estao em uso:')} ${busy.join(', ')}

  Provavelmente uma execucao anterior nao encerrou. Para liberar:

    ${color.cyan(
      IS_WINDOWS
        ? 'netstat -ano | findstr :3333     e depois:  taskkill /PID <numero> /F'
        : 'lsof -ti:3333,5173,8000 | xargs kill',
    )}

  Ou simplesmente feche o terminal onde o ExcelFlow estava rodando.
`);
  process.exit(1);
}

const services = [
  {
    name: 'api   ',
    tint: color.cyan,
    command: 'pnpm',
    args: ['--filter', '@excelflow/api', 'dev'],
    cwd: ROOT,
  },
  {
    name: 'engine',
    tint: color.magenta,
    command: venvPython(),
    args: ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'],
    cwd: join(ROOT, 'services', 'engine'),
  },
  {
    name: 'web   ',
    tint: color.green,
    command: 'pnpm',
    args: ['--filter', '@excelflow/web', 'dev'],
    cwd: ROOT,
  },
];

console.log(`
${color.bold('ExcelFlow')}

  ${color.cyan('http://localhost:5173')}   ${color.dim('sistema (abra este)')}
  ${color.dim('http://localhost:3333')}   ${color.dim('API')}
  ${color.dim('http://localhost:8000')}   ${color.dim('motor de processamento')}

  ${color.dim('Ctrl+C encerra tudo.')}
`);

const children = [];
let shuttingDown = false;

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    shell: IS_WINDOWS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const prefix = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) console.log(`${service.tint(service.name)} ${color.dim('|')} ${line}`);
    }
  };

  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);

  child.on('exit', (code) => {
    if (shuttingDown) return;
    // Um servico caindo sozinho deixa o sistema meio quebrado de um jeito que
    // confunde ("o upload nao responde"). Melhor derrubar tudo e dizer qual foi.
    console.error(
      `\n${color.red('ERRO')} O servico "${service.name.trim()}" encerrou (codigo ${code}).`,
    );
    shutdown(1);
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    // No Windows nao existe sinal de processo: `taskkill /T` derruba a arvore
    // inteira, o que importa porque `pnpm` e `tsx` criam processos filhos que
    // continuariam segurando as portas.
    if (IS_WINDOWS) {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { shell: true });
    } else {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(exitCode), 1500);
}

process.on('SIGINT', () => {
  console.log(color.dim('\nEncerrando...'));
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));
