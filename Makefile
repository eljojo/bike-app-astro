.PHONY: help install dev build preview test test-e2e test-e2e-only test-update test-all test-admin full screenshots maps maps-rebuild validate fonts clean

help: ## Show available targets
	@awk '/^[a-zA-Z0-9_-]+:.*## /{sub(/:.*## /," "); printf "  \033[36m%-15s\033[0m %s\n", $$1, substr($$0, index($$0,$$2))}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	npm install

dev: ## Start dev server
	npx astro dev

build: ## Build static site to dist/
	npx astro build

preview: ## Preview built site locally
	npx astro preview

test: ## Run unit tests
	npx vitest run

test-e2e: build ## Run Playwright screenshot tests
	npx playwright test --config e2e/playwright.config.ts

test-update: build ## Update screenshot baselines
	npx playwright test --config e2e/playwright.config.ts --update-snapshots

test-all: test test-e2e ## Run all tests (unit + e2e)

full: build validate test test-e2e-only ## Run full CI pipeline (build, validate, unit tests, e2e)

test-e2e-only: ## Run e2e tests without rebuilding (use after make build)
	npx playwright test --config e2e/playwright.config.ts

test-admin: ## Run admin E2E tests (hydration + save flow)
	npx playwright test --config e2e/admin.config.ts
	npx playwright test --config e2e/admin-save.config.ts

screenshots: ## Capture production screenshots
	npx playwright test --config e2e/capture-production.config.ts

maps: ## Generate map thumbnails
	npx tsx scripts/generate-maps.ts

maps-rebuild: ## Force regenerate all map thumbnails
	npx tsx scripts/generate-maps.ts --force

fonts: ## Download and embed Google Fonts locally
	npx tsx scripts/download-fonts.ts

validate: ## Run content validation
	npx tsx scripts/validate.ts

clean: ## Remove build artifacts
	rm -rf dist/ .astro/
