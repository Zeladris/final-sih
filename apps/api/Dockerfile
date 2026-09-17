# KisanSetu API server (§10).
#
# Built from the repository root so the shared workspace package is available:
#   docker build -f apps/api/Dockerfile .
# docker-compose.yml does this for you.
#
# No secrets are baked in. Supabase keys and ML_SERVICE_URL arrive as
# environment variables at run time.

FROM node:22-slim AS build

WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build -w @kisansetu/shared && npm run build -w @kisansetu/api

# --- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @kisansetu/api --include-workspace-root

COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/dist ./apps/api/dist

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
