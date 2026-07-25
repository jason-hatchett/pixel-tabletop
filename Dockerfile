# Multi-stage: transpile + bundle with Node, then serve the static bundle with nginx.
# The app is a static Vite SPA today (no backend) — this image just serves dist/.
# When the Phase 5 WebSocketSync server lands, add a second service; this stays the web tier.
#
# Stages:
#   dev   — Vite dev server (HMR) on Node 22, for `docker compose up dev`.
#   build — transpile + bundle to /app/dist.
#   serve — nginx serving the built bundle (production/preview).

# ---- dev stage (reproducible local dev; identical Node 22 on every machine) ----
FROM node:22-alpine AS dev
WORKDIR /app
# Deps baked into the image; docker-compose mounts source over /app but keeps
# node_modules in a named volume (alpine binaries must not be shadowed by the host).
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
# --host so the server is reachable from the host; compose sets polling for WSL.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Install deps against the lockfile first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

# Transpile (tsc --noEmit) + bundle (vite build) → /app/dist
COPY . .
RUN npm run build

# ---- serve stage ----
FROM nginx:1.27-alpine AS serve
# SPA routing + sane static caching.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine already runs the daemon in the foreground via its entrypoint.
