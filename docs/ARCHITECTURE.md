# ExcelFlow — Arquitetura

> Documento vivo. Atualizado a cada fase concluída.
> Versão: 1.0 (Fases 0 a 10)

---

## 1. Problema

Planilhas Excel chegam periodicamente com a **mesma estrutura** e precisam do **mesmo tratamento**:
filtrar, remover duplicados, somar, contar, exportar. Hoje isso é manual, repetitivo e sujeito a erro
humano. O objetivo é transformar esse trabalho em **regras salvas e reexecutáveis**, sem que o usuário
escreva código ou fórmulas.

A unidade de valor do sistema não é "abrir uma planilha". É a **Receita** (§5): um conjunto salvo de
passos + análises que se aplica a qualquer planilha com a mesma estrutura, com um clique.

---

## 2. Decisões de arquitetura (e por que divergem do pedido original)

### 2.1 SQL Server é plano de controle, não plano de dados — **decisão central**

O pedido original era "banco de dados: SQL Server". Mantido, **mas com escopo restrito**.

Guardar as linhas da planilha em tabelas SQL Server e rodar `WHERE`/`SUM`/`GROUP BY` nelas parece
natural e é a pior opção disponível:

| Problema | Consequência |
|---|---|
| Row-store, sem compressão colunar | `SUM` de 1 coluna lê as ~40 colunas do disco |
| Cada upload precisaria de uma tabela dinâmica | DDL em runtime, ciclo de vida frágil, risco de injeção |
| Ingestão de 500k linhas | Segundos a minutos, e infla o log de transação |
| Esquema varia a cada planilha | Ou vira EAV (lento e horrível) ou vira DDL dinâmico (inseguro) |

**Solução adotada — separação de planos:**

```
PLANO DE CONTROLE (SQL Server)          PLANO DE DADOS (Parquet + DuckDB)
─────────────────────────────           ────────────────────────────────
usuários, sessões                       linhas da planilha
metadados do dataset                    execução de filtros
esquema das colunas (perfil)            agregações (soma/média/contagem)
receitas / regras salvas                paginação da grade
histórico de execuções                  geração do arquivo exportado
logs de auditoria
                    ↑ pequeno, transacional, duradouro
                                        ↑ grande, efêmero, analítico
```

**Por que Parquet + DuckDB:**

- **Parquet** é colunar e comprimido. Uma planilha de 500k linhas × 40 colunas que ocupa ~180 MB em
  `.xlsx` vira tipicamente 15–40 MB em Parquet, com tipos já resolvidos.
- **DuckDB** é um motor analítico *embutido* (sem servidor, sem porta, sem container). Lê Parquet
  direto do disco com *projection pushdown* (lê só as colunas usadas) e *predicate pushdown*
  (pula blocos que não podem casar com o filtro).
- Consumo de memória é **constante**, não proporcional ao arquivo. É a única das três opções que
  atende 500k+ linhas sem heurística.
- Não adiciona infraestrutura: é uma biblioteca, como o SQLite.

> Consequência prática: `SELECT SUM(valor) FROM 'dataset.parquet' WHERE status = ?` sobre 500 mil
> linhas responde em dezenas de milissegundos, sem carregar a planilha na RAM.

### 2.2 Motor de processamento em Python, separado da API

- **API (Node/Fastify)**: HTTP, autenticação, autorização, SQL Server, orquestração. Nunca toca em
  bytes de planilha além de repassá-los.
- **Engine (Python/FastAPI)**: ingestão de Excel, perfilamento, execução de receitas, exportação.

Motivos:

1. **Leitura de Excel**: `python-calamine` (Rust) lê `.xlsx` e — importante — `.xls` legado, formato
   que as bibliotecas Node modernas praticamente abandonaram. É ordens de grandeza mais rápido que
   `openpyxl`.
2. **Não bloquear o event loop**: converter uma planilha de 100 MB é trabalho pesado de CPU. Em Node
   isso congela *todas* as requisições concorrentes. Em processo separado, a API continua responsiva.
3. **Superfície de ataque isolada**: o parsing de arquivos não confiáveis é o ponto mais arriscado do
   sistema. Fica num processo separado, sem credenciais de banco, sem acesso à rede externa.

O engine **não é exposto publicamente**. Só a API fala com ele, autenticada por segredo compartilhado.

### 2.3 O navegador nunca recebe a planilha inteira

Nenhum endpoint devolve mais de `MAX_PAGE_SIZE` (500) linhas. A grade é paginada no servidor +
virtualizada no cliente. Filtros, ordenação e busca são resolvidos no backend. Isso é o que impede o
navegador de travar — não a virtualização sozinha.

### 2.4 Um único conceito unifica "filtros salvos", "tratamento" e "análises": a Receita

O pedido descrevia três telas separadas. Implementá-las como três mecanismos separados produziria
código duplicado e, pior, impediria a combinação "filtrar → deduplicar → somar" — que é exatamente o
caso de uso real descrito. Ver §5.

---

## 3. Visão geral

```
┌─────────────────────────────────────────────────────────────────────┐
│  NAVEGADOR — React + Vite + TS + Tailwind                           │
│  Upload · Dashboard · Grade · Construtor de filtros · Análises       │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS · JSON · cookie httpOnly (refresh)
                             │         Authorization: Bearer (access)
┌────────────────────────────▼────────────────────────────────────────┐
│  API — Node 22 + Fastify + TypeScript          (público, :3333)     │
│  auth · autorização · validação Zod · orquestração · auditoria      │
└──────┬──────────────────────────────────────┬───────────────────────┘
       │ mssql (TDS)                          │ HTTP interno + segredo
┌──────▼───────────────────┐        ┌─────────▼───────────────────────┐
│  SQL SERVER 2022         │        │  ENGINE — Python 3.11 + FastAPI │
│  ─────────────────       │        │  (interno, :8000, sem internet) │
│  users, refresh_tokens   │        │  ingestão · perfil · execução   │
│  datasets, columns       │        │  exportação                     │
│  recipes, versions       │        │      DuckDB  ·  Polars          │
│  executions, metrics     │        └─────────┬───────────────────────┘
│  exports, audit_logs     │                  │ leitura/escrita
└──────────────────────────┘        ┌─────────▼───────────────────────┐
                                    │  STORAGE (disco → S3/Blob)      │
                                    │  originals/  datasets/ (parquet)│
                                    │  exports/         TTL: 72 h     │
                                    └─────────────────────────────────┘
```

---

## 4. Estrutura de pastas

```
excelflow/
├── docs/
│   └── ARCHITECTURE.md            este documento
├── docker-compose.yml             SQL Server local
├── .env.example                   contrato de configuração
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── packages/
│   └── contracts/                 ⭐ FONTE ÚNICA DE VERDADE
│       └── src/
│           ├── common.ts          tipos base, paginação, erros
│           ├── auth.ts            login, registro, tokens
│           ├── dataset.ts         metadados e perfil de colunas
│           ├── filters.ts         AST de filtros (§5.1)
│           ├── recipe.ts          passos + métricas (§5.2)
│           ├── execution.ts       resultado e histórico
│           └── index.ts
│
├── apps/
│   ├── api/                       Node + Fastify
│   │   └── src/
│   │       ├── config/env.ts      validação de env com Zod (falha rápido)
│   │       ├── db/
│   │       │   ├── pool.ts        pool mssql
│   │       │   ├── migrator.ts    runner de migrations
│   │       │   └── migrations/    0001_*.sql, 0002_*.sql ...
│   │       ├── lib/               errors, senha, tokens, async-handler
│   │       ├── plugins/           security, error-handler, auth
│   │       ├── modules/
│   │       │   ├── auth/          rotas + serviço + repositório
│   │       │   ├── health/
│   │       │   ├── datasets/      (Fase 2)
│   │       │   ├── recipes/       (Fase 8)
│   │       │   └── executions/    (Fase 9)
│   │       ├── app.ts             composição
│   │       └── server.ts          bootstrap
│   │
│   └── web/                       React + Vite
│       └── src/
│           ├── lib/               cliente HTTP, utilitários
│           ├── components/ui/     primitivos (Button, Input, Card...)
│           ├── features/
│           │   ├── auth/
│           │   ├── upload/        (Fase 2)
│           │   ├── dashboard/     (Fase 2)
│           │   ├── grid/          (Fase 3)
│           │   ├── filters/       (Fases 4–5)
│           │   └── analytics/     (Fase 6)
│           ├── routes/
│           └── App.tsx
│
└── services/
    └── engine/                    Python + FastAPI
        └── app/
            ├── config.py
            ├── security.py        autenticação do canal interno
            ├── routers/
            ├── ingestion/         (Fase 2) leitura → Parquet
            ├── engine/            (Fases 4–6) AST → SQL DuckDB
            └── export/            (Fase 7)
```

**Regra de dependência**: `web` e `api` dependem de `contracts`. `contracts` não depende de ninguém.
O engine consome o JSON Schema gerado a partir de `contracts`. Nunca o contrário.

---

## 5. Motor de regras

### 5.1 AST de filtros

Um filtro é uma **árvore**, não uma lista. É isso que permite
`(Status = APROVADO E Valor > 500) OU (Status = PENDENTE E Valor > 1000)`.

```jsonc
{
  "type": "group",
  "logic": "OR",
  "children": [
    { "type": "group", "logic": "AND", "children": [
        { "type": "condition", "column": "status", "operator": "equals",       "value": "APROVADO" },
        { "type": "condition", "column": "valor",  "operator": "greater_than", "value": 500 }
    ]},
    { "type": "group", "logic": "AND", "children": [
        { "type": "condition", "column": "status", "operator": "equals",       "value": "PENDENTE" },
        { "type": "condition", "column": "valor",  "operator": "greater_than", "value": 1000 }
    ]}
  ]
}
```

Limites impostos pelo schema: profundidade ≤ 6, ≤ 200 nós, ≤ 1000 valores em `in`/`not_in`.
Impede que uma árvore maliciosa vire uma consulta patológica.

**Operadores** (texto · número · data · vazio · booleano):
`equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `in`, `not_in`,
`greater_than`, `greater_or_equal`, `less_than`, `less_or_equal`, `between`,
`date_equals`, `date_before`, `date_after`, `date_between`,
`is_empty`, `is_not_empty`, `is_true`, `is_false`.

### 5.2 Receita = passos + métricas

Uma Receita é a **unidade salva e reexecutável**. Substitui, num só conceito, "filtros salvos",
"tratamento de dados" e "análises":

```jsonc
{
  "version": 1,
  "steps": [
    { "kind": "filter", "filter": { /* AST acima */ } },
    { "kind": "drop_duplicates", "columns": ["documento"], "keep": "first" },
    { "kind": "select_columns", "columns": ["documento", "status", "valor", "data"] },
    { "kind": "sort", "by": [{ "column": "valor", "direction": "desc" }] }
  ],
  "metrics": [
    { "id": "qtd",   "operation": "count",  "label": "Quantidade de aprovados" },
    { "id": "total", "operation": "sum",    "column": "valor", "label": "Valor total" },
    { "id": "media", "operation": "avg",    "column": "valor", "label": "Valor médio" }
  ]
}
```

Passos disponíveis: `filter`, `drop_duplicates`, `drop_empty_rows`, `select_columns`,
`drop_columns`, `rename_columns`, `sort`, `cast`, `replace_values`, `fill_empty`.

Operações de métrica: `count`, `count_distinct`, `count_empty`, `sum`, `avg`, `min`, `max`,
`median`, `percentage`.

### 5.3 Compilação para SQL — e por que é segura

O engine compila a Receita para SQL DuckDB. **Duas regras invioláveis:**

1. **Toda coluna é validada contra o esquema do dataset.** Uma coluna que não existe no perfil
   registrado é rejeitada antes de qualquer geração de SQL. Identificadores nunca vêm do usuário —
   vêm da lista conhecida de colunas, e são citados com escape de `"`.
2. **Todo valor é *parâmetro vinculado*** (`?`), nunca concatenado na string SQL.

```
Receita (JSON validado)
   → valida colunas contra o perfil do dataset
   → compila em CTEs encadeadas, uma por passo
   → SELECT final com parâmetros vinculados
   → DuckDB executa sobre o Parquet
```

Consequência: **não existe caminho** pelo qual texto do usuário — ou saída da IA — vire SQL
executável. A IA (Fase 10) produz *a mesma Receita JSON*, que passa pela *mesma validação*. Ela é só
mais um produtor de receitas, sem privilégio nenhum.

---

## 5.4 Inferência de tipos na ingestão

O problema que justifica esta seção: planilhas exportadas de sistemas legados
trazem **números e datas como texto, no formato brasileiro**. A coluna
"Valor da operação" chega como `"R$ 1.234,56"` e "Data" como `"01/09/2026"`.
Tratadas como texto, o usuário não consegue somar nem filtrar por período — que
é exatamente o que ele veio fazer.

A inferência opera em duas etapas: decide o tipo a partir de uma **amostra**
(1000 valores, em Python puro), depois converte a coluna inteira com **uma
expressão Polars vetorizada**.

Regras que exigiram decisão:

| Situação | Decisão | Por quê |
|---|---|---|
| `1.234` é 1234 ou 1,234? | Se **qualquer** valor da coluna usa vírgula decimal, o ponto é separador de milhar **na coluna toda** | Decidir célula a célula produziria escalas misturadas na mesma coluna — erro grave e silencioso num relatório financeiro |
| `03/09/2026` | 3 de setembro (dia antes do mês) | Público brasileiro; a ordem inversa corromperia todo filtro por período |
| `(1.234,56)` | −1234,56 | Parênteses contábeis são negativo |
| 1 célula suja em 10 | Coluna continua numérica; a célula vira nulo | Uma sujeira não pode custar ao usuário a capacidade de somar a coluna |
| `"0"` e `"1"` | Número, não booleano | Aparecem como número muito mais vezes |
| `-`, `N/A`, `não informado` | Nulo | Para que "está vazio" funcione independentemente da convenção da planilha |
| CSV com `;` e latin-1 | Detectados e transcodificados | Padrão de exportação brasileiro — vírgula já é o separador decimal |

Cada uma dessas regras tem teste (`services/engine/tests/test_inference.py`).

---

## 5.5 Assistente de linguagem natural (Fase 10)

Opcional: sem `ANTHROPIC_API_KEY` o sistema funciona por completo e o campo não
aparece.

**O modelo produz uma forma intermediária mais simples que a Receita** — plana,
sem recursão, com grupos de condições combinados por OU. A Receita real tem
árvore de profundidade arbitrária e uniões discriminadas por operador; pedir
isso diretamente a um modelo aumenta a chance de saída inválida sem ganho: um
pedido em linguagem natural cabe em dois níveis. O **código** — determinístico e
testado — converte para a Receita completa.

```
texto em português
   → modelo (structured outputs, schema fechado)
   → plano intermediário
   → conversão em código: cada coluna conferida contra o dataset
   → recipeSchema.parse()  ← o MESMO schema da interface visual
   → compilador parametrizado  ← o MESMO compilador
   → apresentado ao usuário para CONFERÊNCIA
   → só então aplicado
```

**Três camadas de defesa, nesta ordem:**

1. O schema de saída é fechado — o modelo só pode nomear operadores que existem.
2. Toda coluna citada é resolvida contra o perfil do dataset. Um nome inventado
   vira **aviso ao usuário**, não filtro.
3. A Receita resultante passa pelo `recipeSchema` e pelo compilador, que
   revalida colunas e vincula todo valor como parâmetro.

O assistente **propõe**; a pessoa **aplica**. Um filtro errado aplicado em
silêncio produz um número plausível e errado — que alguém leva para uma reunião.

---

## 6. Banco de dados (SQL Server)

Convenções: `UNIQUEIDENTIFIER` com `NEWSEQUENTIALID()` como PK (evita fragmentação de índice
clusterizado), `DATETIME2(3)` em UTC, `NVARCHAR` para texto, `SYSUTCDATETIME()` como default.

| Tabela | Papel | Fase |
|---|---|---|
| `users` | Contas, hash Argon2id, papel (`admin`/`user`) | 1 |
| `refresh_tokens` | Sessões: hash do token, família, rotação, detecção de reúso | 1 |
| `audit_logs` | Quem fez o quê, quando, de onde | 1 |
| `datasets` | Um upload: nome original, tamanho, hash, caminhos, status, expiração | 1 |
| `dataset_columns` | Perfil por coluna: tipo inferido, nulos, únicos, min/máx, amostras | 1 |
| `recipes` | Receita salva ("Processamento padrão") | 1 |
| `recipe_versions` | Histórico imutável do JSON da receita | 1 |
| `executions` | Cada execução: receita, dataset, contagens, duração, status | 1 |
| `execution_metrics` | Resultado numérico de cada métrica | 1 |
| `exports` | Arquivos gerados, formato, expiração | 1 |

**Nenhuma linha de planilha é armazenada no SQL Server.** As tabelas guardam metadados, regras e
histórico. As planilhas vivem no storage com TTL.

### Ciclo de vida dos dados

```
upload → original em storage/originals/  (imutável, nunca alterado)
       → conversão              → storage/datasets/<id>.parquet
       → perfilamento           → dataset_columns
       ...uso...
       → execução               → executions + execution_metrics (permanente)
       → export                 → storage/exports/  (TTL curto)
       → após DATASET_TTL_HOURS → arquivos apagados; metadados e histórico permanecem
```

O arquivo original **nunca é modificado**. Todo processamento produz artefatos novos.

---

## 7. API REST — `/api/v1`

Implementado na Fase 1:

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Liveness (sem auth) |
| `GET` | `/health/ready` | Readiness: verifica SQL Server |
| `POST` | `/auth/register` | Cria conta |
| `POST` | `/auth/login` | Access token + cookie de refresh |
| `POST` | `/auth/refresh` | Rotaciona refresh, novo access |
| `POST` | `/auth/logout` | Revoga a sessão atual |
| `POST` | `/auth/logout-all` | Revoga todas as sessões do usuário |
| `GET` | `/auth/me` | Usuário autenticado |
| `POST` | `/datasets` | Upload multipart; devolve dataset + perfil das colunas |
| `GET` | `/datasets` | Lista paginada das planilhas do usuário |
| `GET` | `/datasets/:id` | Metadados + perfil completo das colunas |
| `DELETE` | `/datasets/:id` | Remove registro e arquivos |

Planejado (fases seguintes):

| Fase | Rotas |
|---|---|
| ~~2~~ | *implementado — ver tabela acima* |
| 3 | `POST /datasets/:id/rows` (paginação + ordenação + busca) |
| 4–6 | `POST /datasets/:id/preview` (receita → prévia) · `POST /datasets/:id/execute` |
| 7 | `POST /executions/:id/export` · `GET /exports/:id/download` |
| 8 | `GET|POST /recipes` · `GET|PUT|DELETE /recipes/:id` · `POST /recipes/:id/apply` |
| 9 | `GET /executions` · `GET /executions/:id` |
| 10 | `POST /ai/interpret` (texto → Receita JSON, validada e **nunca** executada direto) |

**Formato de erro** — uniforme em toda a API:

```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "Dados inválidos",
             "details": [{ "path": "email", "message": "E-mail inválido" }],
             "requestId": "req-a1b2c3" } }
```

---

## 8. Estratégia para planilhas grandes

| Etapa | Técnica | Efeito |
|---|---|---|
| Upload | Streaming para disco, limite de bytes aplicado *durante* a escrita | Arquivo grande nunca entra na RAM |
| Conversão | `calamine` → Arrow → Parquet, em lotes | Memória constante |
| Perfil | Agregações DuckDB numa passada | Uma leitura do Parquet |
| Grade | `LIMIT`/`OFFSET` no DuckDB + virtualização | ≤ 500 linhas no navegador |
| Filtro | Predicados empurrados para o Parquet | Blocos irrelevantes nem são lidos |
| Métricas | Agregação colunar | Lê só as colunas envolvidas |
| Export | Escrita em streaming | Memória constante |

Alvos: 10k instantâneo · 100k < 2 s · 500k+ processado em background com job assíncrono
(tabela `jobs` + polling; sem Redis até que a medição justifique).

---

## 9. Segurança

**Autenticação** — Argon2id (`memoryCost` 19 MiB, `timeCost` 2, paralelismo 1, conforme OWASP).
Access token JWT de 15 min. Refresh token opaco de 256 bits, guardado **só como hash SHA-256**, em
cookie `httpOnly` + `sameSite=lax` + `path` restrito ao endpoint de refresh. Rotação a cada uso com
**detecção de reúso**: um refresh apresentado duas vezes revoga a família inteira de sessões — sinal
de token roubado.

**Upload** — extensão *e* magic bytes conferidos (um `.xlsx` é um ZIP: `PK\x03\x04`); limite de
tamanho aplicado durante a escrita; nome de arquivo original nunca usado como caminho em disco (o
caminho é derivado de um UUID); proteção contra *zip bomb* (limite de razão de descompressão);
parsing isolado no engine, sem credenciais.

**Injeção** — SQL do plano de controle é 100% parametrizado (`mssql` com `input()`). SQL do plano de
dados é gerado por compilador com colunas em whitelist e valores vinculados (§5.3).

**Injeção de fórmula no CSV** — valores exportados que começam com `= + - @` recebem prefixo de
neutralização. Sem isso, uma planilha processada pode executar comandos ao ser aberta no Excel de
outra pessoa.

**Isolamento** — todo acesso a dataset/receita/execução filtra por `user_id`. Um ID adivinhado não
dá acesso a nada (evita IDOR).

**Cabeçalhos e limites** — Helmet, CORS restrito por lista de origens, rate limit global e
específico no login (contra força bruta).

**Auditoria** — login, logout, upload, execução e export gravados em `audit_logs`. Logs estruturados
(Pino) com `requestId`, **sem** dados de planilha e **sem** segredos.

**Retenção** — uma rotina horária apaga os **arquivos** de datasets vencidos e marca o registro como
`expired`. A linha e o perfil das colunas permanecem: o histórico precisa continuar dizendo o que foi
processado, mesmo depois que o dado sumiu. Dado da empresa não fica parado no servidor
indefinidamente.

**Índices filtrados: evitados deliberadamente** — SQL Server exige `SET QUOTED_IDENTIFIER ON` para
qualquer DML numa tabela que tenha índice filtrado (`Msg 1934`). O driver TDS do Node usa `ON`, mas
sqlcmd em certos modos, jobs do SQL Agent e várias ferramentas de ETL usam `OFF` — e falhariam ao
escrever. O ganho era marginal (uma linha por upload, não milhões); a migration `0003` os substituiu
por índices simples.

---

## 10. Roadmap

| Fase | Entrega | Status |
|---|---|---|
| 0 | Monorepo, Docker, contratos, migrations | ✅ |
| 1 | Autenticação ponta a ponta, esqueleto dos 3 apps | ✅ |
| 2 | Upload, conversão para Parquet, perfilamento, dashboard | ✅ |
| 3 | Grade paginada e virtualizada | ✅ |
| 4 | Construtor visual de filtros | ✅ |
| 5 | Filtros combinados AND/OR aninhados | ✅ |
| 6 | Análises e métricas sobre o resultado filtrado | ✅ |
| 7 | Exportação Excel/CSV com aba de resumo | ✅ |
| 8 | Receitas salvas e reaplicação | ✅ |
| 9 | Histórico de execuções | ✅ |
| 10 | IA: linguagem natural → Receita validada | ✅ |
| 11 | Endurecimento de segurança e otimização | ⬜ |
