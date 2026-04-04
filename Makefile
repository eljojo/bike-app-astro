.PHONY: help install dev build preview test test-lambda typecheck lint validate-ctx test-e2e test-update test-admin test-blog test-club screenshots full prebuild map-style icon-paths maps maps-rebuild validate fonts contributors docs-dev docs-build docs-preview setup-video setup-city deploy-lambda record-fixtures record-plausible clean hooks release publish release-scaffolder publish-scaffolder

help: ## Show available targets
	@awk '/^[a-zA-Z0-9_-]+:.*## /{sub(/:.*## /," "); printf "  \033[36m%-15s\033[0m %s\n", $$1, substr($$0, index($$0,$$2))}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	npm install

dev: prebuild ## Start dev server (set DEV_HOST in .env for remote access)
	RUNTIME=local DEV_ADMIN=true npx astro dev

build: prebuild ## Build static site to dist/
	npx astro build

preview: prebuild ## Preview built site locally
	npx astro preview

test: prebuild ## Run unit tests
	npx astro sync
	npx vitest run

test-lambda: ## Run Lambda unit tests (aws/video-agent)
	node --test aws/video-agent/handler.test.mjs

typecheck: prebuild ## Run TypeScript type checking
	npx astro sync
	npx tsc --noEmit

lint: ## Run ESLint checks
	npx eslint src/

validate-ctx: ## Validate _ctx/ context system (links, frontmatter, index)
	npx tsx scripts/validate-ctx.ts

test-e2e: prebuild ## Build with CITY=demo, validate, then run Playwright tests
	@rm -rf .astro
	CITY=demo RUNTIME= npx astro build
	CITY=demo npx tsx scripts/validate.ts
	@node -e "\
	  const fs = require('fs');\
	  const f = 'dist/server/wrangler.json';\
	  const c = JSON.parse(fs.readFileSync(f, 'utf8'));\
	  c.vars = { ...c.vars, R2_ACCOUNT_ID: 'test-account-id' };\
	  c.d1_databases = [{ binding: 'DB', database_name: 'test', database_id: 'local' }];\
	  fs.writeFileSync(f, JSON.stringify(c));"
	@for f in drizzle/migrations/*.sql; do npx wrangler d1 execute DB --local --config dist/server/wrangler.json --file "$$f"; done
	npx playwright test --config e2e/playwright.config.ts $(if $(CI),,--ignore-snapshots) $(if $(TEST_FILTER),-g "$(TEST_FILTER)")

test-update: prebuild ## Update screenshot baselines
	CITY=demo npx astro build
	npx playwright test --config e2e/playwright.config.ts --update-snapshots

full: test test-lambda typecheck lint test-e2e test-admin test-club ## Run full CI pipeline (unit tests, typecheck, lint, e2e screenshots, admin e2e, club e2e)

test-admin: ## Run admin E2E tests (hydration, save flow, community editing)
	npx playwright test --config e2e/admin/fixture.ts $(if $(CI),,--ignore-snapshots)

test-blog: ## Run blog E2E tests (ride editor)
	npx playwright test --config e2e/blog/fixture.ts $(if $(CI),,--ignore-snapshots)

test-club: ## Run club E2E tests (events, results, waypoints)
	npx playwright test --config e2e/club/fixture.ts $(if $(CI),,--ignore-snapshots)

screenshots: prebuild ## Update all screenshot baselines (public + admin)
	CITY=demo npx astro build
	npx playwright test --config e2e/playwright.config.ts --update-snapshots
	npx playwright test --config e2e/admin/fixture.ts --update-snapshots

prebuild: ## Run all code generators (map style, icons, maps, contributors, path geometry)
	npx tsx scripts/prebuild.ts

map-style: ## Generate cycling map style JSON
	npx tsx scripts/build-map-style.ts

icon-paths: ## Generate Phosphor icon path registry for Preact islands
	npx tsx scripts/build-icon-paths.ts

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

hooks: ## Install pre-commit hook (lint + typecheck)
	bash scripts/setup-hooks.sh

setup-video: ## Run video pipeline setup (pass ARGS for subcommands)
	node scripts/setup-aws-video.js $(ARGS)

setup-city: ## Ensure wrangler env and CI matrix for each city
	node scripts/setup-city.js $(ARGS)

deploy-lambda: ## Deploy video Lambda code to AWS
	cd aws/video-agent && zip -j /tmp/video-agent.zip handler.mjs && aws lambda update-function-code --function-name video-agent --zip-file fileb:///tmp/video-agent.zip --region us-east-1 && aws lambda wait function-updated --function-name video-agent --region us-east-1

record-fixtures: ## Re-record Google Directions API fixtures (requires GOOGLE_PLACES_API_KEY in .env)
	@if [ -z "$$GOOGLE_PLACES_API_KEY" ] && [ -f .env ]; then \
		export $$(grep -v '^#' .env | xargs); \
	fi; \
	if [ -z "$$GOOGLE_PLACES_API_KEY" ]; then \
		echo "Skipping: GOOGLE_PLACES_API_KEY not set (check .env)"; \
		exit 0; \
	fi; \
	echo "Recording Fixture 2 (no shaping points)..."; \
	hurl --variable google_api_key=$$GOOGLE_PLACES_API_KEY \
		e2e/fixtures/google-directions/record-fixture2.hurl \
		--output e2e/fixtures/google-directions/fixture2-directions.json; \
	echo "Recording Fixture 3 (with shaping points)..."; \
	hurl --variable google_api_key=$$GOOGLE_PLACES_API_KEY \
		e2e/fixtures/google-directions/record-fixture3.hurl \
		--output e2e/fixtures/google-directions/fixture3-directions.json; \
	echo "Canonicalizing JSON..."; \
	jq -S . e2e/fixtures/google-directions/fixture2-directions.json > /tmp/f2.json && mv /tmp/f2.json e2e/fixtures/google-directions/fixture2-directions.json; \
	jq -S . e2e/fixtures/google-directions/fixture3-directions.json > /tmp/f3.json && mv /tmp/f3.json e2e/fixtures/google-directions/fixture3-directions.json; \
	echo "Done. Review the JSON files before committing."

record-plausible: ## Re-record Plausible API fixtures (requires PLAUSIBLE_API_KEY in .env)
	@if [ -z "$$PLAUSIBLE_API_KEY" ] && [ -f .env ]; then \
		export $$(grep -v '^#' .env | xargs); \
	fi; \
	if [ -z "$$PLAUSIBLE_API_KEY" ]; then \
		echo "Error: PLAUSIBLE_API_KEY not set (check .env)"; \
		exit 1; \
	fi; \
	echo "Recording page breakdown (90d)..."; \
	hurl --variable plausible_api_key=$$PLAUSIBLE_API_KEY \
		e2e/fixtures/plausible/record-page-breakdown.hurl \
		--output e2e/fixtures/plausible/page-breakdown.json; \
	echo "Recording page breakdown (all time)..."; \
	hurl --variable plausible_api_key=$$PLAUSIBLE_API_KEY \
		e2e/fixtures/plausible/record-page-breakdown-full.hurl \
		--output e2e/fixtures/plausible/page-breakdown-full.json; \
	echo "Recording daily aggregate..."; \
	hurl --variable plausible_api_key=$$PLAUSIBLE_API_KEY \
		e2e/fixtures/plausible/record-daily-aggregate.hurl \
		--output e2e/fixtures/plausible/daily-aggregate.json; \
	echo "Recording page daily..."; \
	hurl --variable plausible_api_key=$$PLAUSIBLE_API_KEY \
		e2e/fixtures/plausible/record-page-daily.hurl \
		--output e2e/fixtures/plausible/page-daily.json; \
	echo "Recording video plays..."; \
	hurl --variable plausible_api_key=$$PLAUSIBLE_API_KEY \
		e2e/fixtures/plausible/record-video-plays.hurl \
		--output e2e/fixtures/plausible/video-plays.json; \
	echo "Done. Review the JSON files before committing."

clean: ## Remove build artifacts
	rm -rf dist/ .astro/

# --- npm publishing ---

release: ## Bump version, commit. Asks which bump type.
	@current=$$(node -p "require('./package.json').version"); \
	major=$$(echo $$current | cut -d. -f1); \
	minor=$$(echo $$current | cut -d. -f2); \
	patch=$$(echo $$current | cut -d. -f3); \
	echo "Current version: $$current"; \
	echo "  1) patch — $$major.$$minor.$$((patch + 1))"; \
	echo "  2) minor — $$major.$$((minor + 1)).0"; \
	echo "  3) major — $$((major + 1)).0.0"; \
	printf "Which bump? [1] "; \
	read choice; \
	case "$${choice:-1}" in \
		1) new="$$major.$$minor.$$((patch + 1))" ;; \
		2) new="$$major.$$((minor + 1)).0" ;; \
		3) new="$$((major + 1)).0.0" ;; \
		*) echo "Invalid choice"; exit 1 ;; \
	esac; \
	npm version $$new --no-git-tag-version; \
	git add package.json package-lock.json; \
	git commit -m "Release whereto-bike@$$new"; \
	echo "Done. Run 'make publish' to tag, publish, and push."

publish: ## Tag, npm publish, and push. Run after 'make release'.
	@version=$$(node -p "require('./package.json').version"); \
	echo "Publishing whereto-bike@$$version"; \
	npm publish --access public; \
	git tag -a "v$$version" -m "whereto-bike@$$version"; \
	printf "Push to origin? [Y/n] "; \
	read push; \
	case "$${push:-y}" in \
		[Yy]*) git push && git push origin "v$$version" ;; \
		*) echo "Tag created locally. Push with: git push && git push origin v$$version" ;; \
	esac

release-scaffolder: ## Bump create-bike-blog version and commit.
	@current=$$(node -p "require('./packages/create-bike-blog/package.json').version"); \
	major=$$(echo $$current | cut -d. -f1); \
	minor=$$(echo $$current | cut -d. -f2); \
	patch=$$(echo $$current | cut -d. -f3); \
	echo "Current create-bike-blog version: $$current"; \
	echo "  1) patch — $$major.$$minor.$$((patch + 1))"; \
	echo "  2) minor — $$major.$$((minor + 1)).0"; \
	echo "  3) major — $$((major + 1)).0.0"; \
	printf "Which bump? [1] "; \
	read choice; \
	case "$${choice:-1}" in \
		1) new="$$major.$$minor.$$((patch + 1))" ;; \
		2) new="$$major.$$((minor + 1)).0" ;; \
		3) new="$$((major + 1)).0.0" ;; \
		*) echo "Invalid choice"; exit 1 ;; \
	esac; \
	cd packages/create-bike-blog && npm version $$new --no-git-tag-version; \
	git add packages/create-bike-blog/package.json; \
	git commit -m "Release create-bike-blog@$$new"; \
	echo "Done. Run 'make publish-scaffolder' to tag, publish, and push."

publish-scaffolder: ## Tag, npm publish create-bike-blog, and push.
	@version=$$(node -p "require('./packages/create-bike-blog/package.json').version"); \
	echo "Publishing create-bike-blog@$$version"; \
	cd packages/create-bike-blog && npm publish --access public; \
	git tag -a "create-bike-blog@$$version" -m "create-bike-blog@$$version"; \
	printf "Push to origin? [Y/n] "; \
	read push; \
	case "$${push:-y}" in \
		[Yy]*) git push && git push origin "create-bike-blog@$$version" ;; \
		*) echo "Tag created locally. Push with: git push && git push origin create-bike-blog@$$version" ;; \
	esac
