# whereto.bike

Open-source cycling platform — the WordPress for cycling. One codebase, three modes: personal ride blogs, community route wikis, and randonneuring club archives. City-specific instances, community-maintained, multilingual by default. AGPL-licensed.

`CLAUDE.md` is a symlink to this file (`AGENTS.md`).

## Why This Exists

1. **Increase the number of first-time bicycle riders.**
2. **Tap into experienced riders to help achieve goal 1.**

Every product decision, every line of copy, every feature choice passes through these two goals.

## Who This Is For

Someone who loves cycling wants to share it with someone they care about. They're looking for the right ride — somewhere worth going, not too far, good surface. Maybe there's a bakery at the turnaround point, or a lookout over the river, or a swimming spot for after. They need the information to be truthful, because this is how cycling clicks for a new person. Not through arguments or marketing, but through one good ride.

If the distance is off, if the surface info is missing, if nobody mentioned the hill or the cafe at kilometre twelve — that ride goes differently. And someone who could have discovered that a bicycle is freedom might not try again.

That's what this software carries. A route wiki helps a city's riders find and share the good roads. A personal blog lets someone show what cycling has given them. A club archive preserves the history of people who ride long distances together. Each mode, done well, puts more people on bicycles.

A bicycle for the mind already exists. This is the other half.

### Take the path that leads to more cycling

When two approaches both work, choose the one that results in more people riding — feature prioritisation, copy tone, default settings, what gets prominent placement. A route page that highlights the waterfall at kilometre eight does more for cycling than one that leads with elevation gain. A place index full of picnic spots and viewpoints does more than a list of bike shops.

Serve both sides of human psychology. Some people need reassurance — accurate distances, surface types, traffic info. Others need a reason to go — the destination, the scenery, the excuse to be outside. Safety information is the floor. Joy is the ceiling.

---

## Ownership Mindset

You own the outcome, not just the task. A route description might be the only thing standing between someone and their first ride. A club's event archive is the history of a community. The code you write carries real things for real people.

- **You are an AI and you will be wrong.** Your confidence in tracing a mechanism is not evidence that the mechanism works. When debugging has gone through multiple rounds without finding the cause, stop tracing and question whether the mechanism should exist. AI defaults to "one more trace will find it" — that confidence is the failure mode, not a tool. When the user says previous attempts failed or your instinct is wrong, that's the most important signal — not background noise to push through. **When you're drifting:** if the user rejects your approach or corrects you more than twice in a row, assume you've lost context. Stop. Re-read this file and the current implementation plan before continuing. Don't argue from memory.

- **Verify before claiming done.** After any change, grep for related terms, rebuild, run relevant tests. Show proof, not promises. A claim without evidence is a guess — and AI is especially prone to confident guesses. If you say it works, show the output. If you say it's fixed, show the test passing. If you can't demonstrate the test failing without your change, you can't be sure it's testing anything. Don't leave verification to others.

- **Search before creating.** Before adding a constant, helper, or type, grep for where it might already exist. One source of truth. If you need a list of values, find the authoritative list and derive from it — don't create a second copy that will drift.

- **Trace all connections.** When removing or changing something, find every reference: code, styles, translations, types, tests, build config. Removing a feature means removing the HTML, the CSS, the translation keys, the functions, the tests — all of it.

- **Delete, don't hide.** If something shouldn't exist, remove it completely. Don't comment it out, don't hide it with CSS, don't wrap it in a dead conditional.

- **Understand the system before changing it.** Read the existing implementation. Match its patterns. This codebase has conventions — vendor isolation, data locality, the save pipeline pattern — that exist for good reasons.

---

## Development Principles

- **Empathy.** The people using this range from experienced randonneurs to someone Googling "bike rides near me" for the first time. Every page, every label, every default should make sense to the least experienced person who might see it. Never use absolute fitness language ("easy", "hard") — use relative framing ("shorter than most rides on this site").

- **Universality.** Three instance types, multiple languages, cities on every continent. Never assume a single locale, measurement system, or way of organising cycling. Build for the general case. Hardcode nothing.

- **Show, don't tell.** Real photos taken by real people on real rides. Real routes ridden by someone who was there. No stock imagery, no AI-generated content, no pitching. The product speaks through what it contains.

- **Domain-driven design.** The codebase models cycling reality: routes, rides, tours, events, places, waypoints, organisers. These aren't arbitrary labels — they're how cyclists already think. When a new feature fits naturally into the domain model, it's probably right. When it needs workarounds, the model might need to grow. Name things what cyclists call them. When the domain model is right, features follow naturally. When it's wrong, every feature is a workaround.

- **Stand the test of time.** A club's event archive spans decades. A blog's ride history is a personal record. Content must not depend on a specific host, a specific API, or this project's continued existence. Data lives in Git as plain files — Markdown, YAML, GPX. No lock-in. No proprietary formats. The content outlives the platform.

- **Keep docs current.** When changing behaviour, update the relevant docs and AGENTS.md files in the same commit. Stale docs are worse than no docs.

---

## Voice & Feel

The voice is a friend who loves cycling showing you around. Not a brand, not a guide, not an instructor — a person who rides this road and wants you to enjoy it too. The warmth is real but not performed. You shouldn't be able to point at any one sentence and say "that's the friendly sentence." The friendliness is structural: it's in the clarity, the pacing, the fact that someone thought about what you'd need to know.

**What to avoid isn't enthusiasm — it's *performed* enthusiasm.** "You're gonna love this trail!" is performing. A description that mentions the river view at the halfway point and the cafe where you can refill your water is genuinely helpful — and that helpfulness is warm.

**The core principle:** write like someone who took time to choose these words. Not someone filling in a template, not someone trying to sound upbeat. A person who rides, writing for someone who might.

**Cadence:**
- Sentences that don't rush. Short is fine. But not clipped.
- Words that feel placed, not emitted.
- Room for a human touch — a detail only someone who rode there would mention. Not every line needs to be minimal.

**Concrete rules:**
- Prefer human words over technical ones. "Ride" not "route segment." "Turn around at the lighthouse" not "reverse direction at waypoint 7."
- Address people directly. "You'll pass a bakery at kilometre four" not "There is a bakery located at kilometre four."
- No exclamation marks in UI copy. Period.
- Use em dashes ( — ) not double hyphens (--) or unspaced dashes.
- Drop filler: "simply", "just", "easily", "basically."
- Contractions are fine where they sound natural. Don't force them and don't avoid them.
- Never use absolute fitness language. "Shorter than most rides on this site" not "An easy ride." "Steady climb for 2 km" not "A hard hill."
- Places matter. Mention the cafe, the viewpoint, the swimming spot, the bench with the good shade. These are why people ride.

**The vibe:**
- Not: "You're gonna crush this ride!" (performed enthusiasm)
- Not: "Proceed along the designated cycling path." (mechanical)
- Not: "This route is 12 km." (correct but lifeless)
- But: "Twelve kilometres along the river. There's a good spot to stop at the bridge."

Warm, clear, human. Like someone who's been there.

---

## Brand & Product Framing

- **whereto.bike** — Global cycling platform (umbrella brand, AGPL)
- **ottawabybike.ca** — Ottawa instance, established local brand (est. 2022), "powered by whereto.bike"
- **{city}.whereto.bike** — Future city subdomains
- **Three instance types:** wiki (community route database), blog (personal ride journal), club (randonneuring/event archive). One codebase, conditionally enabled features. See `instance_type` in city config.
- **Rider first, contributor second.** Lead with utility (find a ride), not contribution (add a GPX).
- **Human over algorithmic.** Every photo was taken by someone who was there. Every route was ridden by a real person.
- **Don't name competitors.** Let the product speak for itself.

## Quick Start

```sh
nix develop        # enter dev shell (node 22, vips, playwright)
make install       # npm install
make dev           # astro dev server on localhost:4321
```

Run `make` to see all available targets.

**IMPORTANT:** All commands (`make`, `npm`, `npx`, etc.) MUST be run inside `nix develop`. Either enter the shell interactively or prefix commands: `nix develop --command bash -c "make build"`.

---

## Mandatory Rules

### No Bracket Filenames

NEVER create files with `[` or `]` in their names (e.g. `[slug].astro`, `[id].ts`). Astro's file-based routing convention of bracket filenames is forbidden in this project.

Dynamic routes are registered via `injectRoute()` in Astro integrations. View files live in `src/views/` with plain names. See `src/integrations/i18n-routes.ts` for public routes and `src/integrations/admin-routes.ts` for admin/API routes.

### Vendor Isolation

Every cloud service is behind an adapter interface. Swap Cloudflare to Docker by changing one adapter. NEVER import platform-specific modules (e.g. `cloudflare:workers`, AWS SDK, Vercel helpers) directly in application code. All platform APIs must be accessed through a single wrapper file in `src/lib/`. One wrapper file per vendor concern — if they rename or break their API, only one file changes. No exceptions.

### Authorize Every Endpoint

Every server-rendered API endpoint MUST call `authorize(user, action)` from `src/lib/auth/authorize.ts`. Middleware protects routes but `authorize()` is the endpoint-level permission check. Forgetting it is a security hole. The `require-authorize-call` ESLint rule enforces this.

### Server Boundary Convention

Files in `src/lib/` follow a `.server.ts` naming convention. Files without `.server` in the name are **browser-safe** — they can be imported by Preact components and must not use Node.js APIs (`node:path`, `node:fs`, `node:crypto`). Files with `.server.ts` are **server-only** — they can use Node APIs and are only imported by server views, loaders, build scripts, and other `.server.ts` files.

Two ESLint rules enforce this:
- `no-server-import-in-browser` — blocks `.server` imports from `.tsx` files and shared `.ts` files in `src/lib/`
- `no-restricted-imports` — bans `node:*` imports in non-`.server` files within `src/lib/`

**Exempt:** Adapter files (`*.adapter-*.ts`), `git/` directory, build-time transform files (`city-config.ts`), and virtual-module-dependent files (`map-thumbnails.ts`).

When splitting a mixed file: types, schemas, and pure functions stay in `.ts`. Functions using Node APIs move to a `.server.ts` companion. See `src/lib/models/` for the pattern.

### Don't Shrug Off Broken Things

If something fails — a build, a tool, a command — investigate it. Don't dismiss it as "pre-existing" or "not my problem." A broken build you work around is a broken build you'll ship against. Diagnose it, fix it or raise it. Never normalize broken infrastructure.

### Never Hardcode City/Locale Values

NEVER write string literals like `'ottawa'` or `'fr'` in application code. Always import `CITY` from `src/lib/config/config.ts`. Check city config for available locales. The codebase supports multiple cities via the `CITY` env var.

---

## Gotchas

**These apply to any work under `src/` — not optional reading:**

- **Prerender flags**: every page/API endpoint MUST export `prerender` (true or false).
- **Virtual module types**: `src/virtual-modules.d.ts` is ambient — NO top-level imports or it breaks all declarations.
- **No client-side navigation**: the site uses full page loads, not `<ClientRouter />`. Use `DOMContentLoaded`, not `astro:page-load`.
- **Content model layer**: all code that reads or writes content data must go through model files in `src/lib/models/`. Never hand-roll `JSON.stringify`/`JSON.parse` for content types.
- **Zod v4**: import from `astro/zod`, not `zod`.

Deeper gotchas live in directory-level AGENTS.md files, next to the code they apply to:

- **Save pipeline** (frontmatter merge, content hash, blob SHA): `src/views/api/AGENTS.md`
- **Preact islands** (textarea hydration, scoped CSS, state sync): `src/components/admin/AGENTS.md`
- **Styling** (dark mode, SCSS compiler, admin.scss): `src/styles/AGENTS.md`
- **Core library** (build-time transforms, vendor isolation, config layers, CSP): `src/lib/AGENTS.md`
- **Integrations** (route ordering, bracket filenames, i18n sync): `src/integrations/AGENTS.md`
- **E2E tests** (fixture dates, DB lifecycle, generated files): `e2e/AGENTS.md`
- **Architecture reference** (instance types, content pipeline, virtual modules, checklists, additional gotchas): `src/AGENTS.md`

---

## Architectural Principles

### Static is Sacred

The public site is HTML files in `dist/`. Zip them, serve from anywhere. Admin pages are server-rendered, but if admin goes down, the public site keeps serving. Never make a public page depend on a running server.

### Develop on a Train

`git clone data && git clone app && npm run dev` — no internet needed. No database required. No network calls. If a feature would break offline development, find another way.

### Universal Media Pattern

A single key identifies every media asset. The app resolves it to URLs at render time. Components never touch vendor URLs directly. Photos and videos are equal — all media entries live in one ordered list. Never filter by type, never treat photos and videos as separate collections. The `type` field exists for rendering (`img` vs `video` tag), not for partitioning logic.

### Data Locality

Data lives next to what uses it. Route photos live in the route's `media.yml`. Place photos live in the place's frontmatter. Never centralize data that belongs to a specific content item. City-level files exist only for data with no content item to live next to. When building indexes over distributed data, the index is a **computed view** — never the canonical store.

### Data Insights

The build has simultaneous access to the entire dataset. It computes relationships and rankings that individual pages can't know alone — difficulty scoring, similarity matrix, route shape classification, nearby places. All insights are build-time computation frozen into static HTML. Never compute dataset-wide intelligence at request time.

---

## Architecture Reference

See `src/AGENTS.md` — instance types, content pipeline, configuration layers, adapter boundaries, virtual modules, cache-overlay pattern, save pipeline, CI/CD workflows, and all checklists for adding new things.

## CSS & Styling

See `src/styles/AGENTS.md`. Key: SCSS variables from `_variables.scss`, dark mode needs both variants, Preact island styles go in `admin.scss` only.

## Testing

```sh
make lint          # ESLint checks (src/)
make typecheck     # TypeScript type checking (tsc --noEmit)
make test          # vitest unit tests (tests/)
make test-e2e      # build (CITY=demo) + playwright screenshot tests
make test-admin    # admin E2E tests (save flow, community editing, etc.)
make full          # build + validate + unit + all E2E
```

**Run `make lint` and `make typecheck` before committing.** CI enforces both.

Screenshot tests build against `CITY=demo` (a fixture city). See `e2e/AGENTS.md`.

## Build

```sh
make build         # astro build → dist/
make maps          # generate map thumbnail cache (public/maps/)
make validate      # validate content data
make contributors  # build contributor stats (must run BEFORE astro build)
make fonts         # download and embed Google Fonts
```

**Build order matters:** `make contributors` and `make maps` must run before `astro build` — they generate files consumed by virtual modules.

## Git Conventions

- Never add `Co-Authored-By` lines to commits
- Do not auto-commit — wait for explicit instructions
- PNGs are tracked with Git LFS

### Commit Granularity — Tell a Story

Each commit should be a **coherent, shippable unit of work** that a reviewer can understand on its own. Group meaningfully connected changes. Someone reading `git log` should see a narrative of features and fixes, not a play-by-play of implementation steps.

**The test:** Could this commit be cherry-picked to another branch and make sense?

**Group into one commit:**

- **Extract + wire.** Creating a helper and using it is one logical change.
- **Schema + pipeline + UI for one feature.** A field added to a schema, threaded through the pipeline, and rendered in the UI is one feature.
- **Code change + its test updates.** If your change breaks tests, fix them in the same commit.
- **Code change + its docs.** AGENTS.md updates belong with the code they describe.
- **Mechanical refactors across multiple files.** Group by theme, not by file.

**Keep separate when:**

- Changes are truly independent (a bugfix and an unrelated feature)
- A commit would be too large to review (~400+ lines of non-mechanical changes)
- Different changes have different risk profiles (safe refactor vs. behaviour change)

**Plan steps ≠ commits.** Steps are how you work; commits are how you communicate what changed.

## Related Repos

- `~/code/bike-app` — Rails app (production source of truth for CSS matching). Plans/design docs go in `~/code/bike-app/docs/plans/`
- `~/code/bike-routes` — Content data repo (routes, guides, events, places)
- `~/code/bike-routes-golden-tests` — Golden test artifacts (production screenshots)

## Environment Variables

See `.env.example` for the full list. Key variables: `RUNTIME=local` for offline dev, `CONTENT_DIR` for data repo path, `CITY` for city selection (default: `ottawa`, E2E: `demo`).
