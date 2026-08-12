# ── Stage 1: Build ────────────────────────────────────────
#
# Build context is the MONOREPO ROOT, not apps/server — npm workspaces keep a
# single lockfile at the root and refuse to install a member without it. See
# the `build:` block in docker-compose.yml.
FROM node:22-alpine AS builder
WORKDIR /repo

# Manifests first so a source-only change does not re-run the install layer.
# Every workspace manifest must be present or npm ci rejects the lockfile as
# out of sync, hence the desktop package.json even though it is not built here.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/

# --ignore-scripts: the desktop workspace has an electron-builder postinstall
# that is meaningless (and slow) in a server image.
RUN npm ci --workspace apps/server --include-workspace-root --ignore-scripts

WORKDIR /repo/apps/server
COPY apps/server/prisma ./prisma/
COPY apps/server/prisma.config.ts ./
RUN npx prisma generate

COPY apps/server/ ./
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Workspace installs hoist shared dependencies to the repo root, so both
# node_modules trees are needed — the root one holds almost everything.
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/server/node_modules ./node_modules
COPY --from=builder /repo/apps/server/dist ./dist
COPY --from=builder /repo/apps/server/package.json ./
COPY --from=builder /repo/apps/server/prisma ./prisma
COPY --from=builder /repo/apps/server/prisma.config.ts ./
COPY --from=builder /repo/apps/server/src/instruction/agent_instruction.md ./src/instruction/agent_instruction.md

EXPOSE 3003

# DATABASE_URL is supplied whole by the environment — the image does not
# assemble it from host/user/password parts. One variable means one thing to
# get right, and it is the same string Prisma, psql and every hosted Postgres
# provider already speak.
#
# Migrations run on start rather than in a separate step so that a self-hoster's
# only deploy command stays `docker compose up -d`. `migrate deploy` applies
# pending migrations and is a no-op when there are none.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
