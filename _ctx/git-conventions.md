---
description: Commit granularity, message style, no co-author lines, LFS for PNGs
type: rule
triggers: [committing changes, writing commit messages, preparing a PR, git operations]
related: [protocol-destructive-actions]
---

# Git Conventions

## Hard rules

- **Never add `Co-Authored-By` lines** to commit messages. Not for any reason.
- **Do not auto-commit.** Wait for explicit instructions from the user.
- **Do not push unless told to push.** "Commit" does not mean "commit and push."
- **PNGs are tracked with Git LFS.** Use `git lfs track` for new PNG patterns if needed.
- **Never use `git add -A` or `git add .`** — always add specific files by name.
- **Never use interactive flags** (`-i`) — `git rebase -i` and `git add -i` require interactive input that isn't supported.

## Commit granularity — tell a story

Each commit should be a **coherent, shippable unit of work** that a reviewer can understand on its own. Someone reading `git log` should see a narrative of features and fixes, not a play-by-play of implementation steps.

**The test:** Could this commit be cherry-picked to another branch and make sense?

### Group into one commit

- **Extract + wire.** Creating a helper and using it is one logical change.
- **Schema + pipeline + UI for one feature.** A field added to a schema, threaded through the pipeline, and rendered in the UI is one feature.
- **Code change + its test updates.** If your change breaks tests, fix them in the same commit.
- **Code change + its docs.** AGENTS.md updates belong with the code they describe.
- **Mechanical refactors across multiple files.** Group by theme, not by file.

### Keep separate when

- Changes are truly independent (a bugfix and an unrelated feature)
- A commit would be too large to review (~400+ lines of non-mechanical changes)
- Different changes have different risk profiles (safe refactor vs. behaviour change)

### Plan steps are not commits

Steps are how you work; commits are how you communicate what changed. Ten implementation steps might be one commit. One step might be two commits. The mapping is based on coherence, not sequence.

## Commit message style

Write a concise message that communicates what changed and why. Use the imperative mood ("add", "fix", "update", "remove"). The conventional commits prefix pattern (`feat:`, `fix:`, `refactor:`) is used in this repo.

- `feat:` — a new feature or capability
- `fix:` — a bug fix
- `refactor:` — restructuring without behavior change
- `chore:` — build, CI, tooling changes
- `docs:` — documentation only

Keep the first line under 72 characters. Use the body for context when the "why" isn't obvious from the diff.

## LFS and binary files

PNGs are tracked with Git LFS. Never use `lfs: true` on checkout in CI workflows — use the LFS cache pattern (actions/cache + `git lfs pull`) to avoid bandwidth costs.
