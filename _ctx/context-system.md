---
description: How the _ctx/ knowledge base works — philosophy, loading tiers, types, maintenance
type: knowledge
triggers: [adding context files, maintaining docs, onboarding to the repo, wondering how _ctx/ works]
related: [protocol-ctx-maintenance]
---

# Context System

## What This Is

`_ctx/` is institutional memory made by AIs for AIs. It's a living knowledge base — the AI equivalent of onboarding docs, tribal knowledge, and design rationale combined into one system. Every file exists to make the next AI session smarter about this project.

It is not documentation for humans. It doesn't need to be verbose or formatted for readability. Signal density is everything — every sentence must earn its place.

## Three Functions

### Align

Files that communicate the human's vision, values, and long-term direction. These are vectors — they keep every session pointed the same way, even when no specific task triggers them. An AI that builds a technically correct feature but violates the brand voice or the empathy principle has failed. Alignment files are the ones most at risk of being "optimized away" by an AI focused on the immediate task. They're also the ones that matter most across sessions.

Type: `vision`

### Teach

Files that explain how the app works — what things are, how systems connect, why they were built that way. An AI reading these isn't being constrained, it's being educated. The better it understands the domain, the better decisions it makes without needing explicit rules for every case.

Type: `knowledge`

### Protect

Files that prevent catastrophic mistakes. Rules enforced by CI, protocols triggered by dangerous situations, gotchas that prevent known traps.

Types: `rule`, `protocol`, `gotcha`

## Signal Principle

Every sentence in a `_ctx/` file should pass one of two tests:

1. **Task test:** "Would an AI make a worse decision on a specific task without this?"
2. **Drift test:** "Would removing this cause drift from the human's vision over time, even if no single task would fail?"

If neither answer is yes, it's noise. Cut it.

Noise trains AI to skim. High signal density means AI actually absorbs what it reads. A 20-line file that gets read carefully beats a 200-line file that gets skimmed.

## Broken Windows

A stale file, a wrong reference, a section that no longer matches the code — these are broken windows. Each one teaches the next AI session that `_ctx/` can't be trusted. Once trust erodes, AI stops reading carefully, starts skimming, makes decisions without context. The whole system fails.

Leave no broken windows unnoticed. See [protocol-ctx-maintenance](protocol-ctx-maintenance.md).

## Loading Tiers

### Always-Read (non-optional)

Five files loaded at the start of every session. **Read these before starting any work. This is not optional.** Listed in AGENTS.md under "Always Read."

### Task-Triggered

The rest of `_ctx/`. Each file has a `triggers` field listing when to load it. Before starting work, scan the Context index in AGENTS.md — which files match your task? Read matching files and check their triggers.

### Related

Each file has a `related` field pointing to adjacent context. Follow these links when you need connected understanding, but don't rabbit-hole.

### On Task Transitions

When the kind of work changes (e.g., from spatial analysis to text editing, from debugging to writing), re-check which files are relevant. Rules and knowledge that were active during the previous task may not apply, and new ones may. This is the most dangerous moment for context loss.

## Type System

| Type | Function | Weight | Meaning |
|------|----------|--------|---------|
| `vision` | Align | High | Sets long-term direction. Alignment vectors for the human's values and goals. |
| `knowledge` | Teach | Medium | Explains how things work. How systems connect, what things are, why decisions were made. |
| `rule` | Protect | Highest | Non-negotiable. Violations are bugs. Often enforced by ESLint/CI. |
| `protocol` | Protect | High | Step-by-step procedures. Follow when triggered. |
| `gotcha` | Protect | Contextual | Known traps. Read when touching the relevant area. |

## Frontmatter Format

```yaml
---
description: One-line hook (AI reads this in the index to decide whether to open the file)
type: vision | knowledge | rule | protocol | gotcha
triggers: [plain-language descriptions of when to load this file]
related: [other-file-stem, another-file-stem]
---
```

## Adding a New File

1. **Check if it's already covered.** Grep existing files first.
2. **Choose the right type.** Most new context is `knowledge`. Use `vision` for directional principles. Use `rule` only for non-negotiable constraints enforced by tooling. Use `protocol` only for step-by-step procedures. Use `gotcha` only for platform-specific traps.
3. **Write clear triggers.** What task would make an AI need this file?
4. **Maximize signal density.** Every sentence earns its place. Write for AI comprehension, not human readability.
5. **Add to the AGENTS.md index.** One line, under the right category heading.
6. **Add `related` references** in both directions.

## Maintenance

Two tiers:

- **Light (every session):** When you change code that a file describes, update the file in the same commit. When you notice a file is wrong, fix it immediately. See [protocol-ctx-maintenance](protocol-ctx-maintenance.md).
- **Deep (periodic):** Dedicated review of all files against current code. Check for staleness, gaps, redundancy, noise, broken windows. See [protocol-ctx-maintenance](protocol-ctx-maintenance.md).

## Contradiction Rule

One source of truth per topic. If two files disagree:
- `rule` type wins over other types
- More specific wins over more general
- Fix the contradiction immediately — don't leave it for the next session

## Validation

Run `make validate-ctx` to check:
- All `_ctx/` links in AGENTS.md files resolve to real files
- All `_ctx/` files have required frontmatter with valid types
- All `_ctx/` files are listed in the root index
- All `related` references point to existing files
- No stray formatting artifacts

This runs in CI.
