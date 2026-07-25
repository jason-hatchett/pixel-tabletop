# OPTIONAL convenience for WSL / Linux / macOS only — `make` is NOT on Windows
# PowerShell. The portable interface everyone shares is `npm run <script>`
# (works on every OS) and `docker compose` — this file only wraps those.
# PowerShell/Windows users: use `npm run dev` / `docker compose up dev` directly.
#
# Thin entry point over npm + docker compose. One command per common task.
# Two tiers: local (needs Node 22 via nvm) and -docker (needs Docker, zero local Node).
.DEFAULT_GOAL := help
.PHONY: help install dev dev-docker test test-docker typecheck build preview up down clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## --- local (Node 22 via `nvm use`) ---
# node_modules auto-installs on first use and re-installs only when the lockfile
# changes, so `make dev` works straight from a fresh clone (one command).
node_modules: package-lock.json
	npm ci
	@touch node_modules

install: node_modules ## Install deps (locked); no-op if up to date
dev: node_modules ## Vite dev server + HMR → http://localhost:5173
	npm run dev
test: node_modules ## Run the vitest suite
	npm test
typecheck: node_modules ## tsc --noEmit
	npm run typecheck
build: node_modules ## Transpile + bundle to dist/
	npm run build
preview: build ## Serve the production build locally → http://localhost:4173
	npm run preview

## --- docker (zero local Node; identical toolchain everywhere) ---
dev-docker: ## Dev server in a pinned Node 22 container → http://localhost:5173
	docker compose up dev
test-docker: ## Run the suite in the container toolchain
	docker compose run --rm dev npm test
up: ## Build + serve the production bundle via nginx → http://localhost:8080
	docker compose up --build web
down: ## Stop and remove compose services
	docker compose down

clean: ## Remove build output and the node_modules volume
	rm -rf dist
	-docker compose down -v
