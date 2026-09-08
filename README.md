# ExcelFlow

Sistema web para automatizar o tratamento, a filtragem e a análise de planilhas
Excel. Em vez de repetir manualmente os mesmos filtros, somas e limpezas a cada
arquivo recebido, o usuário salva o conjunto de regras uma vez e o reaplica com
um clique nas planilhas seguintes.

**Estado atual: Fase 1 concluída** — arquitetura, banco de dados e autenticação
funcionando ponta a ponta. O upload de planilhas chega na Fase 2.

A arquitetura completa está em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Como funciona, em uma frase

Cada planilha enviada é convertida uma vez para **Parquet**; filtros e cálculos
são compilados para SQL parametrizado e executados pelo **DuckDB** sobre esse
arquivo, com memória constante. O **SQL Server** guarda usuários, regras e
histórico — nunca as linhas da planilha.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 · Vite 6 · TypeScript · Tailwind CSS 4 · TanStack Query |
| API | Node 22 · Fastify 5 · TypeScript · Zod |
| Motor | Python 3.11 · FastAPI · DuckDB · Polars · calamine |
| Banco | SQL Server 2022 (metadados, regras e histórico) |
| Dados | Parquet em storage com TTL |

---

## Pré-requisitos

- Node.js ≥ 20.11 e pnpm ≥ 10
- Python ≥ 3.11
- Docker (para o SQL Server local)

---

## Como executar

### 1. Configuração

```bash
cp .env.example .env
```

Para desenvolvimento local os valores padrão já funcionam. **Em produção**, gere
segredos reais — a API se recusa a subir com os valores de exemplo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 2. Banco de dados

```bash
pnpm infra:up          # sobe o SQL Server 2022 em container
```

Aguarde o container ficar saudável (~30 s na primeira vez):

```bash
docker inspect --format='{{.State.Health.Status}}' excelflow-sqlserver
```

### 3. Dependências

```bash
pnpm install
pnpm --filter @excelflow/contracts build    # os outros pacotes dependem disto

cd services/engine
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cd ../..
```

### 4. Migrations

```bash
pnpm migrate           # cria o banco (se preciso) e aplica as migrations
```

### 5. Subir os serviços

```bash
pnpm dev               # API (:3333) + frontend (:5173) em paralelo
```

E, em outro terminal, o motor de processamento:

```bash
cd services/engine
./.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

Acesse **http://localhost:5173**. A primeira conta criada recebe papel de
administrador automaticamente.

---

## Como testar

### Testes automatizados

```bash
pnpm --filter @excelflow/contracts test     # motor de regras: AST e receitas
pnpm typecheck                              # verificação de tipos completa

cd services/engine
ENGINE_SHARED_SECRET=segredo-de-teste ./.venv/bin/python -m pytest -q
```

### Verificação manual da API

```bash
API=http://localhost:3333/api/v1

curl $API/health/ready

curl -X POST $API/auth/register -H 'Content-Type: application/json' -c /tmp/c.txt \
  -d '{"email":"voce@empresa.com","password":"uma-senha-bem-longa","displayName":"Seu Nome"}'

# Rotação do refresh token
curl -X POST $API/auth/refresh -b /tmp/c.txt -c /tmp/c.txt
```

**Teste de segurança relevante:** reapresente um refresh token já usado. A
resposta deve ser 401 e *todas* as sessões daquela família devem ser revogadas —
é a detecção de reúso de token em ação.

---

## Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm dev` | API + frontend em paralelo |
| `pnpm dev:api` / `pnpm dev:web` | Apenas um dos dois |
| `pnpm build` | Build de produção de tudo |
| `pnpm typecheck` | Verificação de tipos em todos os pacotes |
| `pnpm migrate` | Aplica migrations pendentes |
| `pnpm infra:up` / `pnpm infra:down` | Sobe/derruba o SQL Server |

---

## Estrutura

```
packages/contracts/     Schemas Zod — fonte única de verdade dos tipos
apps/api/               Fastify: auth, orquestração, SQL Server
apps/web/               React: interface
services/engine/        Python: ingestão, execução de receitas, exportação
docs/ARCHITECTURE.md    Decisões de arquitetura e roadmap
```

---

## Notas de segurança

- Senhas com **Argon2id** (parâmetros OWASP).
- Access token JWT de 15 min, mantido **apenas em memória** no navegador
  (imune a XSS que leia `localStorage`).
- Refresh token opaco, guardado **só como hash SHA-256**, em cookie `httpOnly`
  com `path` restrito a `/api/v1/auth`, rotacionado a cada uso e com **detecção
  de reúso**.
- Todo SQL do plano de controle é parametrizado.
- O arquivo original enviado **nunca é modificado**.
- Arquivos são apagados automaticamente após `DATASET_TTL_HOURS`.
