# Thin entry point over npm + docker compose. One command per common task.
# Two tiers: local (needs Node 22 via nvm) and -docker (needs Docker, zero local Node).
.DEFAULT_GOAL := help
.PHONY: help install dev dev-docker test test-docker typecheck build preview up down clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## --- local (Node 22 via `nvm use`) ---
install: ## npm ci (locked install)
	npm ci
dev: ## Vite dev server + HMR → http://localhost:5173
	npm run dev
test: ## Run the vitest suite
	npm test
typecheck: ## tsc --noEmit
	npm run typecheck
build: ## Transpile + bundle to dist/
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
