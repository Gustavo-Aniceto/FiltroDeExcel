# ============================================================================
# API (Node + Fastify)
# ============================================================================
# Build em multiplos estagios: as ferramentas de compilacao (TypeScript, tsx,
# devDependencies) ficam no estagio `build` e nao entram na imagem final.
# ============================================================================
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# Copiamos primeiro os manifestos e o lockfile. Enquanto nenhum deles mudar, o
# Docker reaproveita a camada de instalacao -- que e a mais lenta de todas.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --filter @excelflow/contracts... --filter @excelflow/api...

COPY packages/contracts packages/contracts
COPY apps/api apps/api

RUN pnpm --filter @excelflow/contracts build \
 && pnpm --filter @excelflow/api build

# Remove as dependencias de desenvolvimento antes de copiar para a imagem final.
RUN pnpm --filter @excelflow/api --prod deploy /app --legacy

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# tini como PID 1: sem ele, o Node nao recebe SIGTERM corretamente e o
# encerramento gracioso (fechar conexoes, drenar requisicoes) nunca roda.
RUN apk add --no-cache tini

WORKDIR /app
COPY --from=build /app ./

# As migrations sao arquivos .sql, nao compilados pelo tsc: precisam ser
# copiados a parte para dentro de dist/.
COPY --from=build /repo/apps/api/src/db/migrations ./dist/db/migrations

# Nao roda como root: se houver escape do processo, ele nao tem privilegio.
RUN addgroup -g 1001 -S excelflow && adduser -u 1001 -S excelflow -G excelflow \
 && mkdir -p /data && chown -R excelflow:excelflow /app /data
USER excelflow

EXPOSE 3333
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
