---
description: Commit granularity, message style, no co-author lines, LFS for PNGs
type: rule
triggers: [committing changes, writing commit messages, preparing a PR, git operations]
related: [protocol-destructive-actions]
---

# Git Conventions

## Hard rules

- **Never add `Co-Authored-By` lines** to commit messages. Not for any reason.
- **Commits must be meaningful — not granular.** The main-session AI commits autonomously once a coherent unit of work is complete (see "Commit granularity" and "Who runs commits" below). No per-commit authorisation. The bar is meaningfulness; commits that aren't shippable stories don't get made at all. Subagents never commit, regardless.
- **Authorise destructive operations every time.** `git stash`, `git reset --hard`, `git checkout --`, `git restore`, `git clean -f`, `git push --force`, `git rebase`, `git branch -D`, `rm` of tracked files, branch create/switch, and remote pushes all require explicit user authorisation each time. See `protocol-destructive-actions.md`. A normal `git commit` is **not** destructive.
- **Do not push unless told to push.** Pushes are destructive (they touch shared state). "Commit" does not mean "commit and push."
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

### "Independent" means problems, not subsystems

The most common splitting failure: cutting along subsystem or file-type boundaries when the work all serves one outcome. A schema change in `models/`, a save-handler change in `views/api/`, a UI change in `components/admin/`, a middleware change, a DB migration, a client-state change — all touching different directories — can still be **one** commit if they all serve one user-visible outcome.

Two layers of defence on the same problem (e.g. server idempotency + client button-disabled, both preventing the same bad state) are **one** commit. A feature whose only purpose is to recover from a specific bug, plus the prevention of that bug, are **one** commit.

**Heuristic — the one-sentence test:** Write the commit's purpose in one sentence. If you need "and" to bridge two unrelated outcomes, it's two commits. If "and" is just listing facets of the same outcome ("schema change *and* its UI *and* its migration"), it's still one commit. Resist the temptation to split because the diff feels "big" — coherence beats size, and a 600-line coherent commit is easier to review than four 150-line commits that don't make sense apart.

The conventional-commits prefixes (`feat:`, `fix:`) are message style, not splitting criteria. "It's a feature *and* a fix" is not a reason for two commits if both serve one purpose.

### Plan steps are not commits

Steps are how you work; commits are how you communicate what changed. Ten implementation steps might be one commit. One step might be two commits. The mapping is based on coherence, not sequence.

### Who runs commits

- **Subagents:** zero git authority. Never run any git command — not `add`, not `commit`, not `status`, not `branch`. Every implementer/reviewer prompt must include this prohibition. (See `feedback_no_auto_commit.md`.)
- **Main-session AI (controller):** commits autonomously. The user does not authorise each commit individually — the meaningful-commit rule above is what makes autonomous committing safe. When a coherent unit of work is complete (tests pass, lint passes, the change tells one story), the controller runs `git add <named files>` and `git commit -m "..."` without asking. "Don't auto-commit" in this repo's older guidance meant *don't commit incremental noise*, not *ask before every commit*.
- **The user:** sets workflow scope (what to build, when to start, branch names) and authorises **destructive** git operations every time. "Destructive" means anything in the `protocol-destructive-actions.md` list (stash, reset --hard, checkout --, restore, clean, push --force, rebase, branch -D, rm of tracked files), plus branch create/switch and remote pushes. **A normal `git commit` is not destructive** and does not need per-commit authorisation.

The split exists because committing is a write that you can always reach back through history; destructive operations destroy history or working state that may not be recoverable.

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
