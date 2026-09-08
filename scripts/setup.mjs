/**
 * Preparacao do ambiente de desenvolvimento. Rode uma vez:
 *
 *   pnpm setup
 *
 * O script e IDEMPOTENTE: rodar de novo nao quebra nada e serve para consertar
 * um ambiente pela metade. Cada etapa detecta se ja foi feita e pula.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  color,
  fail,
  findPython,
  has,
  ok,
  run,
  sleep,
  step,
  venvExists,
  venvPython,
  warn,
} from './lib.mjs';

const ENGINE_DIR = join(ROOT, 'services', 'engine');

console.log(color.bold('\nExcelFlow — preparacao do ambiente\n'));

// ---------------------------------------------------------------------------
step('Verificando pre-requisitos');

const [majorNode] = process.versions.node.split('.').map(Number);
if (majorNode < 20) {
  fail(
    `Node ${process.versions.node} e antigo demais (minimo: 20).`,
    'Baixe a versao LTS em https://nodejs.org',
  );
}
ok(`Node ${process.versions.node}`);

if (!(await has('pnpm'))) {
  fail('pnpm nao encontrado.', 'Instale com:  npm install -g pnpm');
}
ok('pnpm encontrado');

const python = await findPython();
if (!python) {
  fail(
    'Python nao encontrado (necessario 3.11 ou superior).',
    'Baixe em https://www.python.org/downloads/ — no Windows, marque "Add Python to PATH".',
  );
}
ok(`Python encontrado (${python})`);

/**
 * Verificar o Docker exige DUAS checagens, nao uma.
 *
 * `docker --version` responde mesmo com o Docker Desktop fechado -- ele so
 * consulta o programa instalado. O motor e outra coisa: `docker info` fala com
 * o daemon, e e o unico jeito de saber se da para subir um container.
 *
 * Sem essa distincao, o script dizia "Docker encontrado" e falhava tres linhas
 * depois com um erro 500 de pipe do Windows, que nao diz a ninguem que basta
 * abrir o Docker Desktop.
 */
const hasDocker = await has('docker');

// Escotilha de saida para quem ja tem um SQL Server proprio (corporativo, ou
// SQL Server Express instalado direto no Windows). Sem ela, ter o Docker
// instalado e parado bloquearia alguem que nem precisa dele.
const skipDocker = process.env.SKIP_DOCKER === '1';

const dockerRunning =
  !skipDocker &&
  hasDocker &&
  (await has('docker', ['info', '--format', '{{.ServerVersion}}']));

if (skipDocker) {
  warn('SKIP_DOCKER=1 — usando o SQL Server configurado no .env, sem Docker.');
} else if (dockerRunning) {
  ok('Docker em execucao');
} else if (hasDocker) {
  fail(
    'O Docker Desktop esta instalado, mas o motor nao esta em execucao.',
    'Abra o Docker Desktop pelo menu Iniciar e espere aparecer "Engine running".\n' +
      '     Confirme com:  docker ps\n\n' +
      '     Se o Docker Desktop mostrar erro de WSL, rode num PowerShell como\n' +
      '     ADMINISTRADOR:  wsl --update   e reinicie o computador.\n\n' +
      '     Ja tem um SQL Server proprio? Configure-o no .env e rode:\n' +
      '       $env:SKIP_DOCKER=1; pnpm dev',
  );
} else {
  warn('Docker nao encontrado — usando o SQL Server configurado no .env.');
}

// ---------------------------------------------------------------------------
step('Configurando o arquivo .env');

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  ok('.env ja existe (mantido como esta)');
} else {
  copyFileSync(join(ROOT, '.env.example'), envPath);
  ok('.env criado a partir de .env.example');
}

// ---------------------------------------------------------------------------
if (dockerRunning) {
  step('Subindo o SQL Server');
  try {
    await run('docker', ['compose', 'up', '-d', 'sqlserver']);
  } catch {
    fail(
      'Nao foi possivel subir o SQL Server.',
      'Verifique se o Docker Desktop esta aberto e rodando.',
    );
  }

  // O container responde na porta bem antes do SQL Server aceitar conexoes.
  // Migrar cedo demais falha com "login failed", que confunde muito mais do que
  // esperar. Aguardamos o healthcheck do proprio container.
  process.stdout.write('  Aguardando o banco ficar pronto');
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const status = await run(
        'docker',
        ['inspect', '--format', '{{.State.Health.Status}}', 'excelflow-sqlserver'],
        { silent: true },
      );
      if (status.trim() === 'healthy') {
        healthy = true;
        break;
      }
    } catch {
      // Container ainda subindo; continua tentando.
    }
    process.stdout.write('.');
    await sleep(3000);
  }
  console.log('');

  if (!healthy) {
    fail(
      'O SQL Server nao ficou pronto a tempo.',
      'Veja o que aconteceu com:  docker compose logs sqlserver',
    );
  }
  ok('SQL Server no ar');
}

// ---------------------------------------------------------------------------
step('Instalando dependencias do frontend e da API');
await run('pnpm', ['install']);
ok('Dependencias instaladas');

// O pacote de contratos precisa estar compilado ANTES de API e frontend: os
// dois o importam como dependencia de workspace.
step('Compilando os contratos compartilhados');
await run('pnpm', ['--filter', '@excelflow/contracts', 'build']);
ok('Contratos compilados');

// ---------------------------------------------------------------------------
step('Preparando o motor de processamento (Python)');

if (venvExists()) {
  ok('Ambiente virtual ja existe');
} else {
  console.log('  Criando ambiente virtual...');
  await run(python, ['-m', 'venv', '.venv'], { cwd: ENGINE_DIR });
  ok('Ambiente virtual criado');
}

console.log('  Instalando DuckDB, Polars e demais dependencias (pode demorar)...');
try {
  await run(venvPython(), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], {
    cwd: ENGINE_DIR,
    silent: true,
  });
  // requirements-dev.txt inclui o runtime (`-r requirements.txt`) e ainda as
  // ferramentas de teste. Sem elas, as instrucoes de teste do README nao
  // rodariam numa maquina recem-preparada.
  await run(venvPython(), ['-m', 'pip', 'install', '--quiet', '-r', 'requirements-dev.txt'], {
    cwd: ENGINE_DIR,
  });
} catch (error) {
  fail('Falha ao instalar as dependencias Python.', String(error.message).slice(0, 500));
}
ok('Motor de processamento pronto');

// ---------------------------------------------------------------------------
if (dockerRunning || skipDocker || !hasDocker) {
  step('Criando o banco de dados e aplicando as migrations');
  try {
    await run('pnpm', ['--filter', '@excelflow/api', 'migrate']);
  } catch {
    fail(
      'Falha ao aplicar as migrations.',
      'Confira as credenciais em .env e se o SQL Server esta no ar.',
    );
  }
  ok('Banco de dados pronto');
}

// ---------------------------------------------------------------------------
console.log(`
${color.green(color.bold('Tudo pronto.'))}

  Para iniciar o sistema:   ${color.cyan('pnpm dev')}
  Depois abra:              ${color.cyan('http://localhost:5173')}

  Crie a sua conta na primeira tela (a primeira vira administradora).
  Ha planilhas de teste prontas na pasta ${color.cyan('samples/')}.
`);
