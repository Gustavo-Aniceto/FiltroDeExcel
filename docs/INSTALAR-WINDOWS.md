# Instalação no Windows

Guia para uma máquina Windows que ainda não tem ferramentas de desenvolvimento.
Do zero até o sistema rodando.

---

## Passo 1 — Instalar as quatro ferramentas

Abra o **PowerShell** e cole tudo de uma vez:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Docker.DockerDesktop -e
```

Aceite os avisos de permissão que aparecerem.

> **Não tem `winget`?** Ele vem no Windows 11 e no Windows 10 atualizado. Se o
> comando não for reconhecido, instale cada programa manualmente:
> [Git](https://git-scm.com/download/win) ·
> [Node.js LTS](https://nodejs.org) ·
> [Python](https://www.python.org/downloads/) (marque **"Add Python to PATH"**) ·
> [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## Passo 2 — Fechar e abrir o PowerShell

**Este passo não é opcional.** O Windows só reconhece os programas recém-instalados
em janelas de terminal abertas *depois* da instalação. Feche o PowerShell atual e
abra um novo.

---

## Passo 3 — Instalar o pnpm e conferir

No PowerShell **novo**:

```powershell
npm install -g pnpm
```

Depois confira se está tudo no lugar:

```powershell
git --version
node --version
python --version
pnpm --version
docker --version
```

As cinco linhas devem mostrar um número de versão. Se alguma disser
*"não é reconhecido"*, aquele programa não instalou — repita o Passo 1 só para ele.

---

## Passo 4 — Abrir o Docker Desktop

Procure **Docker Desktop** no menu Iniciar e abra. Ele **não inicia sozinho** após
a instalação.

Espere o ícone da baleia na barra de tarefas parar de animar — leva de 30 segundos
a 2 minutos na primeira vez. Só continue quando ele estiver parado.

> Na primeira execução o Docker pode pedir para instalar o **WSL 2** e reiniciar
> o computador. Aceite e reinicie.

---

## Passo 5 — Baixar e rodar

```powershell
cd $HOME
git clone https://github.com/Gustavo-Aniceto/FiltroDeExcel
cd FiltroDeExcel
git checkout claude/excelflow-automation-system-m3pa3w
pnpm dev
```

A primeira execução leva alguns minutos: ela baixa o SQL Server, instala as
dependências e prepara o banco. As próximas sobem em segundos.

Quando aparecer `http://localhost:5173`, abra esse endereço no navegador.

Crie sua conta na primeira tela — a primeira conta vira administradora. Depois
arraste uma planilha da pasta `samples`.

---

## Para usar de novo, depois

```powershell
cd $HOME\FiltroDeExcel
pnpm dev
```

Com o Docker Desktop aberto. Para parar, `Ctrl+C` no PowerShell.

## Para receber correções

```powershell
cd $HOME\FiltroDeExcel
git pull
pnpm dev
```

---

## Se algo der errado

| Mensagem | O que fazer |
|---|---|
| `'git' não é reconhecido` | Você não abriu um PowerShell novo depois de instalar (Passo 2) |
| `'pnpm' não é reconhecido` | Rode `npm install -g pnpm` num PowerShell novo |
| `error during connect` / `docker daemon` | O Docker Desktop não está aberto, ou ainda está iniciando |
| `Estas portas ja estao em uso` | Feche o PowerShell onde o ExcelFlow estava rodando |
| SQL Server não fica pronto | Veja `docker compose logs sqlserver`. Costuma ser memória: o Docker precisa de ~2 GB livres |
| Python não encontrado | Reinstale marcando **"Add Python to PATH"** |

Se aparecer algo fora desta lista, copie a mensagem inteira do terminal — ela
costuma dizer exatamente o que falta.
