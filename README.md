# ExcelFlow

Sistema web para automatizar o tratamento, a filtragem e a análise de planilhas
Excel. Em vez de repetir manualmente os mesmos filtros, somas e limpezas a cada
arquivo recebido, o usuário salva o conjunto de regras uma vez e o reaplica com
um clique nas planilhas seguintes.

**Estado atual: Fases 1 a 9 concluídas.** O ciclo completo funciona: envie uma
planilha, monte filtros visualmente, calcule somas e médias, trate os dados,
exporte o resultado, salve as regras e reaplique com um clique na planilha
seguinte. Falta a Fase 10 (assistente por linguagem natural, opcional).

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

## Como rodar

### Pré-requisitos

| | Onde obter | Observação |
|---|---|---|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) | Escolha a versão LTS |
| **pnpm** | `npm install -g pnpm` | |
| **Python 3.11+** | [python.org](https://www.python.org/downloads/) | No Windows, marque **"Add Python to PATH"** no instalador |
| **Docker Desktop** | [docker.com](https://www.docker.com/products/docker-desktop/) | Só para o SQL Server. Deixe-o **aberto** antes de começar |

### Um comando

```bash
pnpm dev
```

Na primeira execução ele prepara tudo sozinho: cria o `.env`, sobe o SQL Server,
instala as dependências, compila os contratos, monta o ambiente Python e aplica
as migrations. Leva alguns minutos. Nas execuções seguintes, sobe em segundos.

Quando aparecer `http://localhost:5173`, abra no navegador.

> **Mac com chip Apple (M1/M2/M3/M4):** a Microsoft não publica imagem ARM do
> SQL Server. Nas configurações do Docker Desktop, ative
> *General → Use Rosetta for x86/amd64 emulation* antes de rodar.

### Primeiros passos no sistema

1. **Crie sua conta** na primeira tela — a primeira conta vira administradora.
2. **Arraste uma planilha** da pasta `samples/`:

   | Arquivo | O que exercita |
   |---|---|
   | `operacoes.xlsx` | 8.000 linhas com tipos nativos do Excel, duplicidades e campos vazios |
   | `operacoes_texto_brasileiro.xlsx` | O caso difícil: `R$ 1.234,56` e `01/09/2026` como **texto**, além de `Sim/Não` e marcadores `N/A` |
   | `operacoes_latin1.csv` | CSV brasileiro de verdade: separador `;` e acentuação latin-1 |

3. **Veja o dashboard** montado a partir das colunas encontradas.

   Vale conferir se o sistema acertou: no arquivo de texto brasileiro, a coluna
   *Valor da operação* deve aparecer como **Moeda** com soma calculada — e não
   como texto.

4. **Monte um filtro** na aba *Filtros*: `Status = APROVADO`. O valor vem de uma
   lista, não é digitado. Adicione `Valor da operação > 5000`. O resultado
   atualiza sozinho.

5. **Combine com OU**: clique em *Grupo* para criar
   `(Status = APROVADO E Valor > 5000) OU (Status = PENDENTE E Valor > 7000)`.

6. **Calcule** na aba *Análises*: soma, média, maior e menor — sempre sobre o
   resultado filtrado.

7. **Trate** na aba *Tratamento*: remova duplicados por `Documento`, escolha as
   colunas, renomeie.

8. **Exporte**. O `.xlsx` sai com duas abas: *Resultado* e *Resumo* (com as
   análises).

9. **Salve a regra** como "Processamento padrão". Volte, envie
   `operacoes_texto_brasileiro.xlsx` e aplique a mesma regra pelo menu
   *Regras salvas* — é aqui que o sistema paga o próprio custo.

10. **Confira o histórico** no menu superior: cada exportação fica registrada
    com as regras exatas que rodaram.

### Se algo der errado

| Sintoma | Causa provável |
|---|---|
| `docker: command not found` | Docker Desktop não está aberto |
| `porta 3333 já em uso` | Uma execução anterior ficou viva — feche o terminal e abra outro |
| SQL Server não fica pronto | Veja `docker compose logs sqlserver`; costuma ser falta de memória (precisa de ~2 GB) |
| Erro de Python no `pnpm dev` | Apague `services/engine/.venv` e rode `pnpm bootstrap` |

Para recomeçar do zero, apagando inclusive o banco:

```bash
docker compose down -v
pnpm bootstrap
```

### Alternativa: tudo em contêiner

Se preferir não instalar Node e Python na máquina, o sistema inteiro roda em
contêineres:

```bash
docker compose up -d --build     # depois abra http://localhost:8080
```

Mais lento para desenvolver (não há *hot reload*), mas não exige nada além do
Docker.

---

## Como testar

### Testes automatizados

```bash
pnpm test          # motor de regras: AST de filtros e receitas
pnpm typecheck     # verificação de tipos nos três pacotes

cd services/engine
./.venv/bin/python -m pytest -q      # inferência de tipos e ingestão
```

No Windows, o último comando é `.venv\Scripts\python -m pytest -q`.

### Verificação manual da API

```bash
API=http://localhost:3333/api/v1

TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"voce@empresa.com","password":"sua-senha"}' | jq -r .accessToken)

curl -X POST $API/datasets -H "Authorization: Bearer $TOKEN" \
  -F "file=@samples/operacoes.xlsx"
```

**Testes de segurança que valem a pena repetir:**

- Renomeie qualquer arquivo (um `.pdf`, um `.exe`) para `.xlsx` e envie →
  rejeitado pelos *magic bytes*, não pela extensão.
- Reapresente um refresh token já usado → 401, e **todas** as sessões daquela
  família são revogadas (detecção de reúso de token).
- Peça `GET /datasets/:id` de outra conta → **404**, não 403: a API não confirma
  sequer que o recurso existe.

---

## Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe os três serviços (prepara o ambiente na primeira vez) |
| `pnpm bootstrap` | Só a preparação do ambiente |
| `pnpm test` | Testes do motor de regras |
| `pnpm typecheck` | Verificação de tipos |
| `pnpm build` | Build de produção |
| `pnpm migrate` | Aplica migrations pendentes |
| `pnpm db:up` / `pnpm db:down` | Sobe/para apenas o SQL Server |
| `pnpm docker:up` / `pnpm docker:down` | Sistema inteiro em contêineres |

---

## Estrutura

```
packages/contracts/     Schemas Zod — fonte única de verdade dos tipos
apps/api/               Fastify: auth, upload, orquestração, SQL Server
apps/web/               React: upload, dashboard
services/engine/        Python: leitura de planilha, inferência de tipos, perfil
samples/                Planilhas de exemplo para testar
scripts/                Automação de setup e desenvolvimento
docker/                 Dockerfiles e configuração do nginx
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
