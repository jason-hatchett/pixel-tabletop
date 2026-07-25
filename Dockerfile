# Multi-stage: transpile + bundle with Node, then serve the static bundle with nginx.
# The app is a static Vite SPA today (no backend) — this image just serves dist/.
# When the Phase 5 WebSocketSync server lands, add a second service; this stays the web tier.

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
