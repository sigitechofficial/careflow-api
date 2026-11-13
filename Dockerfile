# Careflow API — container image for Azure Container Apps.
#
#   docker build -t careflow-api .                          API server (default target)
#   docker build --target migrate -t careflow-migrate .     prisma migrate deploy + reference seeds
#                                                          (run as a one-off Container Apps Job)
#   docker build --target whisper-worker -t careflow-whisper .   Whisper speech-to-text worker
#                                                          (Container Apps Job, WHISPER_MODE=azure-job)
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

# ---- whisper-worker: speech-to-text for Initial Assessment recordings ----------
# Run as the Whisper Container Apps Job (WHISPER_MODE=azure-job on the API):
#   docker build --target whisper-worker -t careflow-whisper .
# Same app code as the API (it reads the queue in the database and saves the transcript attachment)
# plus Python + faster-whisper and the model, downloaded at build time so a run never needs the
# internet. No Chromium. Must stay ABOVE the `api` stage: the last stage is the default target.
FROM base AS whisper-worker
ARG WHISPER_MODEL=small
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
ENV HF_HOME=/opt/whisper-models
RUN python3 -m venv /opt/whisper \
 && /opt/whisper/bin/pip install --no-cache-dir faster-whisper==1.2.1 \
 && /opt/whisper/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')" \
 && chmod -R a+rX /opt/whisper-models
ENV NODE_ENV=production \
    WHISPER_PYTHON=/opt/whisper/bin/python \
    WHISPER_MODEL=${WHISPER_MODEL} \
    HF_HUB_OFFLINE=1
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts/whisper ./scripts/whisper
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
CMD ["node", "dist/src/initial-assessments/run-transcription-worker.js"]

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
