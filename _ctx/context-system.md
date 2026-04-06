---
description: How the two-tier _ctx/ context system works — loading protocol, maintenance rules, why it exists
type: knowledge
triggers: [adding context files, maintaining docs, onboarding to the repo, wondering how _ctx/ works]
related: [protocol-drift-correction]
---

# Context System

## Why This Exists

AI attention is finite. When every rule is loaded for every task, they compete with each other. Rules that aren't relevant to the current task dilute the ones that are. Worse: rules don't survive task transitions — an AI that correctly applies a principle during one task drops it when the work reframes as something else.

The postmortem at `~/code/bike-app/docs/2026-03-28-ai-referent-drift-postmortem.md` documents this in detail. The fix isn't more rules — it's better routing of the right rules to the right task.

## How It Works

Two tiers:

- **AGENTS.md** (always loaded) — mission, ownership mindset, mandatory rules, protocol triggers, and a one-line index of `_ctx/` files. This is what every session starts with, regardless of task.
- **`_ctx/*.md`** (task-relevant) — detail files pulled in when their topic matches the current work. Each has a `triggers` field in its frontmatter listing when to load it.

This pattern repeats at every level. Subdirectory AGENTS.md files contain must-knows for that directory plus links to `_ctx/` files for the full patterns.

## Loading Protocol

1. **Root AGENTS.md is automatic.** Every session starts with it. The ownership mindset and mandatory rules are always active.
2. **Before starting work, scan the Context index.** Which `_ctx/` files match your task? A save handler change needs `save-pipeline.md`. A copy edit needs `voice-and-feel.md`. A new content type needs `adding-new-things.md` and `content-model.md`.
3. **Read matching files. Check their `triggers` field.** If your task appears in the triggers list, the file is relevant.
4. **When entering a subdirectory, read its AGENTS.md.** It has must-knows specific to that code.
5. **When the task changes, re-check.** The relevant context may have shifted. This is the most important step — rules that were active during the previous task may not apply, and new ones may.
6. **Follow `related` links** when you need connected context, but don't rabbit-hole. Related files are adjacent context, not required reading.

## Type Weights

| Type | Weight | Meaning |
|------|--------|---------|
| `rule` | Highest | Non-negotiable. Violations are bugs. |
| `protocol` | High | Executable step-by-step procedures. Follow when triggered. |
| `pattern` | Medium | How we do things. Follow unless there's a specific reason not to. |
| `guide` | Medium | Shapes judgment calls. Informs decisions. |
| `gotcha` | Contextual | Read when touching the relevant area. Prevents known mistakes. |
| `roadmap` | Lowest | Where we're going. Context, not instruction. |

## Frontmatter Format

```yaml
---
description: One-line hook (used in the AGENTS.md index)
type: rule | pattern | guide | gotcha | protocol | roadmap
triggers: [plain-language descriptions of when to load this file]
related: [other-file-stem, another-file-stem]
---
```

- **`description`** — the AI reads this in the index to decide whether to open the full file. Make it specific enough to be useful in one line.
- **`type`** — drives how much weight the content carries.
- **`triggers`** — plain-language cues. An AI checks these against its current task.
- **`related`** — cross-reference graph. File stems without `.md`.

## Adding a New File

1. **Check if it's already covered.** Search existing files first.
2. **Choose the right type.** Most new context is `pattern` or `gotcha`. Use `rule` only for non-negotiable constraints. Use `protocol` only for step-by-step procedures.
3. **Write clear triggers.** What task would make an AI need this file?
4. **Add to the root AGENTS.md index.** One line, under the right type heading.
5. **Add `related` references** in both directions (the new file references existing ones, and relevant existing files reference the new one).

## When a File Becomes Stale

Update or delete it. Stale context is worse than no context — it trains the AI to ignore docs. Remove the entry from the AGENTS.md index. Update any files that reference it in their `related` field.

## Contradiction Rule

One source of truth per topic. If two files disagree:
- `rule` type wins over other types
- More specific wins over more general
- Fix the contradiction immediately — don't leave it for the next session

Subdirectory AGENTS.md files add local specifics. They must not contradict root AGENTS.md or `_ctx/` files.

## Validation

Run `make validate-ctx` to check:
- All `_ctx/` links in AGENTS.md files resolve to real files
- All `_ctx/` files have required frontmatter
- All `_ctx/` files are listed in the root index
- No stray formatting artifacts

This runs in CI.

## The Deeper Principle

The goal isn't documentation — it's alignment. A well-loaded AI makes better decisions because it has the right constraints active for the task at hand. The system works when the AI reads less total text but more relevant text. That's the trade: volume for precision.
