# TrialGuard AI — multi-target image
#   docker build --target backend  -t trialguard-backend .
#   docker build --target frontend -t trialguard-frontend .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app

# ---------------------------------------------------------------- deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY agents/package.json agents/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build (backend)
FROM deps AS build-backend
COPY agents agents
COPY backend backend
RUN pnpm --filter @trialguard/agents build \
 && pnpm --filter @trialguard/backend prisma:generate \
 && pnpm --filter @trialguard/backend build

# ---------------------------------------------------------------- backend / worker runtime
FROM base AS backend
ENV NODE_ENV=production
COPY --from=build-backend /app /app
COPY synthetic-data /app/synthetic-data
ENV SYNTHETIC_DATA_DIR=/app/synthetic-data STORAGE_DIR=/data/storage
RUN mkdir -p /data/storage && chown -R node:node /data /app/backend
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

# ---------------------------------------------------------------- build (frontend)
FROM deps AS build-frontend
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_DEMO_PASSWORD=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_DEMO_PASSWORD=$NEXT_PUBLIC_DEMO_PASSWORD
COPY frontend frontend
RUN pnpm --filter @trialguard/frontend build

# ---------------------------------------------------------------- frontend runtime
FROM node:22-bookworm-slim AS frontend
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build-frontend --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build-frontend --chown=node:node /app/frontend/.next/static ./frontend/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "frontend/server.js"]
