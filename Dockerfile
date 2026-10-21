# Careflow API — container image for Azure Container Apps.
#
#   docker build -t careflow-api .                          API server (default target)
#   docker build --target migrate -t careflow-migrate .     prisma migrate deploy + reference seeds
#                                                          (run as a one-off Container Apps Job)
#
# Settings come from the environment (Container Apps / Key Vault); no .env file is baked in.
# Uploads are not baked in either: /app/uploads is where the Azure Files share is mounted.

ARG NODE_IMAGE=node:20-bookworm-slim

# ---- base: runtime OS packages shared by every stage -------------------------
FROM ${NODE_IMAGE} AS base
# openssl: required by the Prisma query engine (debian-openssl-3.0.x)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- deps: full install (Nest build, Prisma CLI and ts-node seeds need dev deps)
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build -------------------------------------------------------------------
FROM deps AS build
COPY . .
# The TypeScript build of this codebase sits near Node's default heap limit on small
# build agents (seen OOM on ACR Tasks); give the compile step explicit headroom.
RUN npx prisma generate && NODE_OPTIONS=--max-old-space-size=3072 npm run build

# ---- prod-deps: runtime node_modules only --------------------------------------
# The generated Prisma client (node_modules/.prisma) is not an npm package, so set it
# aside around the prune to guarantee it survives.
FROM build AS prod-deps
RUN mv node_modules/.prisma /tmp/.prisma \
 && npm prune --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/.prisma && mv /tmp/.prisma node_modules/.prisma

# ---- migrate: migrations + Azure reference seeds (never sample people) --------
FROM build AS migrate
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma migrate deploy && bash prisma/scripts/run-azure-seeds.sh ."]

# ---- api (default) -------------------------------------------------------------
FROM base AS api
# Chromium for HTML→PDF exports (puppeteer-core); fonts so non-Latin names render.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*
# XDG_* dirs: Chromium's crash handler needs a writable config/cache dir; without them
# it aborts ("chrome_crashpad_handler: --database is required") when HOME is not writable.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    XDG_CONFIG_HOME=/tmp/.chromium \
    XDG_CACHE_HOME=/tmp/.chromium
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
