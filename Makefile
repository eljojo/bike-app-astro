.PHONY: help install dev build preview test typecheck test-e2e test-update test-admin screenshots full map-style maps maps-rebuild validate fonts contributors docs-dev docs-build docs-preview clean

help: ## Show available targets
	@awk '/^[a-zA-Z0-9_-]+:.*## /{sub(/:.*## /," "); printf "  \033[36m%-15s\033[0m %s\n", $$1, substr($$0, index($$0,$$2))}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	npm install

dev: build ## Start dev server
	RUNTIME=local npx astro dev

build: map-style ## Build static site to dist/
	npx astro build

preview: map-style ## Preview built site locally
	npx astro preview

test: ## Run unit tests
	npx vitest run

typecheck: ## Run TypeScript type checking
	npx tsc --noEmit

test-e2e: map-style ## Build with CITY=demo, validate, then run Playwright screenshot tests
	CITY=demo npx astro build
	CITY=demo npx tsx scripts/validate.ts
	npx playwright test --config e2e/playwright.config.ts

test-update: map-style ## Update screenshot baselines
	CITY=demo npx astro build
	npx playwright test --config e2e/playwright.config.ts --update-snapshots

full: test typecheck test-e2e test-admin ## Run full CI pipeline (unit tests, typecheck, e2e screenshots, admin e2e)

test-admin: ## Run admin E2E tests (hydration, save flow, community editing)
	npx playwright test --config e2e/admin/fixture.ts

screenshots: map-style ## Update all screenshot baselines (public + admin)
	CITY=demo npx astro build
	npx playwright test --config e2e/playwright.config.ts --update-snapshots
	npx playwright test --config e2e/admin/fixture.ts --update-snapshots

map-style: ## Generate cycling map style JSON
	npx tsx scripts/build-map-style.ts

maps: ## Generate map thumbnails
	npx tsx scripts/generate-maps.ts

maps-rebuild: ## Force regenerate all map thumbnails
	npx tsx scripts/generate-maps.ts --force

fonts: ## Download and embed Google Fonts locally
	npx tsx scripts/download-fonts.ts

contributors: ## Build contributor stats for about page
	npx tsx scripts/build-contributors.ts

validate: ## Run content validation (uses CITY env, defaults to ottawa)
	npx tsx scripts/validate.ts

docs-dev: ## Start docs dev server
	npm run dev -w docs

docs-build: ## Build docs site
	npm run build -w docs

docs-preview: ## Preview built docs site
	npm run preview -w docs

clean: ## Remove build artifacts
	rm -rf dist/ .astro/
