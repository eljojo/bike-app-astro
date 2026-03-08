.PHONY: help install dev build preview test typecheck test-e2e test-update test-admin screenshots full maps maps-rebuild validate fonts contributors clean

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

typecheck: ## Run TypeScript type checking
	npx tsc --noEmit

test-e2e: build ## Run Playwright screenshot tests
	npx playwright test --config e2e/playwright.config.ts

test-update: build ## Update screenshot baselines
	npx playwright test --config e2e/playwright.config.ts --update-snapshots

full: build validate test typecheck test-e2e test-admin ## Run full CI pipeline (build, validate, unit tests, typecheck, all e2e)

test-admin: ## Run admin E2E tests (hydration, save flow, community editing)
	npx playwright test --config e2e/admin/fixture.ts

screenshots: build ## Update all screenshot baselines (public + admin)
	npx playwright test --config e2e/playwright.config.ts --update-snapshots
	npx playwright test --config e2e/admin/fixture.ts --update-snapshots

maps: ## Generate map thumbnails
	npx tsx scripts/generate-maps.ts

maps-rebuild: ## Force regenerate all map thumbnails
	npx tsx scripts/generate-maps.ts --force

fonts: ## Download and embed Google Fonts locally
	npx tsx scripts/download-fonts.ts

contributors: ## Build contributor stats for about page
	npx tsx scripts/build-contributors.ts

validate: ## Run content validation
	npx tsx scripts/validate.ts

clean: ## Remove build artifacts
	rm -rf dist/ .astro/
