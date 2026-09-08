# ============================================================================
# Frontend (React + Vite), servido por nginx
# ============================================================================
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @excelflow/contracts... --filter @excelflow/web...

COPY packages/contracts packages/contracts
COPY apps/web apps/web

RUN pnpm --filter @excelflow/contracts build \
 && pnpm --filter @excelflow/web build

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
