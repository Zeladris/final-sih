# KisanSetu web app (§10).
#
# Built from the repository root:  docker build -f apps/web/Dockerfile .
#
# Vite inlines VITE_* values at BUILD time, so the Supabase URL, the anon key
# and the API URL are build arguments. Only publishable values belong here —
# the service-role key must never reach a browser bundle, and config/env.ts
# fails the API's startup if it ever finds one in a VITE_ variable.

FROM node:20-slim AS build

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL=http://localhost:4000

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_URL=$VITE_API_URL

WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm run build -w @kisansetu/shared && npm run build -w @kisansetu/web

# --- runtime: static files only -------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Single-page app: unknown paths are routes, not missing files.
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
