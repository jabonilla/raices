# Production image for @raices/api (K2.29).
#
# Multi-stage:
#   1. builder — installs all deps, bundles the API + workspace code with esbuild
#   2. final   — non-root, production deps only, single bundled JS file
#
# Build from the repo root:
#   docker build -f apps/api/Dockerfile -t raices-api .
#
# Run (DATABASE_URL required):
#   docker run -e DATABASE_URL=postgres://... -e PORT=3000 -p 3000:3000 raices-api

# ---------------------------------------------------------------- builder ---
FROM node:22-slim AS builder

# pnpm via corepack (matches packageManager in package.json)
RUN corepack enable

WORKDIR /app

# Install dependencies first (better layer caching). Copy only the manifests
# plus the workspace package.json files pnpm needs to resolve workspace:*.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/money/package.json packages/money/package.json
COPY packages/channels/package.json packages/channels/package.json
COPY packages/settlement/package.json packages/settlement/package.json
COPY packages/templates/package.json packages/templates/package.json

RUN pnpm install --frozen-lockfile

# Copy the sources the bundle needs: the API and the workspace packages it
# imports (@raices/money, @raices/channels). esbuild bundles them from source.
# Also copy the repo-root migration runner (scripts/migrate.ts + db-guard.ts)
# and the SQL migrations — K2.43 bundles migrate.ts as dist/migrate.mjs so
# the image can run migrations as a pre-deploy command (tsx is not in the
# final image).
COPY apps/api/src apps/api/src
COPY apps/api/scripts apps/api/scripts
COPY scripts/migrate.ts scripts/db-guard.ts scripts/
COPY db/migrations db/migrations
COPY packages/money/src packages/money/src
COPY packages/channels/src packages/channels/src

RUN pnpm --filter @raices/api build

# ------------------------------------------------------------------ final ---
FROM node:22-slim AS final

# Non-root user. Fixed uid/gid so the image is reproducible and the user
# can own mounted volumes predictably.
RUN groupadd -r appuser --gid 1001 \
  && useradd -r -m --uid 1001 --gid 1001 appuser

WORKDIR /app

# Production dependencies only: the bundle keeps third-party imports
# external (fastify etc. can't be bundled — dynamic require), so they must
# be present in node_modules. Workspace packages are IN the bundle.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/money/package.json packages/money/package.json
COPY packages/channels/package.json packages/channels/package.json
COPY packages/settlement/package.json packages/settlement/package.json
COPY packages/templates/package.json packages/templates/package.json

RUN corepack enable \
  && pnpm install --frozen-lockfile --prod \
  && pnpm store prune

# The bundled app. Owned by appuser so the non-root process can read it.
COPY --from=builder --chown=appuser:appuser /app/apps/api/dist/index.mjs ./dist/index.mjs

# Migration runner (K2.43): second entrypoint for pre-deploy migrations.
# The SQL files ship alongside so the bundle's MIGRATIONS_DIR
# (dist/../db/migrations -> /app/db/migrations) resolves. No tsx needed.
COPY --from=builder --chown=appuser:appuser /app/apps/api/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=builder --chown=appuser:appuser /app/db/migrations ./db/migrations

USER appuser

ENV NODE_ENV=production
EXPOSE 3000

# Readiness probe: /ready returns 200 only when Postgres is reachable,
# 503 otherwise. start-period gives the app time to boot before the first
# check counts against it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.mjs"]
