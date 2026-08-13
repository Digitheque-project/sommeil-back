# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# sommeil-back — image de production (NestJS).
#
# Ces variables sont lues au RUNTIME (pas besoin de --build-arg) :
# fournissez-les via `docker run -e` ou `--env-file` (voir .env.example
# pour la liste complète).
#
# Build :
#   docker build -t sommeil-back .
#
# Run :
#   docker run -p 8888:8888 --env-file .env sommeil-back
# ─────────────────────────────────────────────────────────────────────────

# ── Étape 1 : dépendances ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Étape 2 : build ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Étape 3 : image de production ────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nodejs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

USER nodejs
EXPOSE 8888

CMD ["node", "dist/main"]
