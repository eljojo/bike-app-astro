---
description: Before any git command that modifies working tree — list files, explain why, get confirmation
type: protocol
triggers: [git stash, git checkout --, git restore, git reset, git clean, git push --force, discarding changes]
related: [git-conventions, protocol-drift-correction]
---

# Destructive Actions Protocol

## Commands that require this protocol

Any command that could discard uncommitted changes or rewrite history:

- `git stash` — removes all uncommitted modifications
- `git checkout -- <path>` — discards working tree changes
- `git restore <path>` — discards working tree changes
- `git reset --hard` — discards both staged and working tree changes
- `git clean -f` — deletes untracked files permanently
- `git push --force` — rewrites remote history
- `git rebase` — rewrites local history
- `git branch -D` — deletes a branch with unmerged commits

## Before running any of these commands

1. **Run `git status`** — see everything in the working tree. Understand the full picture.
2. **Run `git diff --stat`** — see which files have changes and how many lines are affected.
3. **List the specific files** that will be affected by the destructive command.
4. **Explain why** the destructive action is necessary. What problem does it solve?
5. **Ask the user for explicit confirmation.** Do not proceed without it.

Uncommitted working directory changes may be the user's in-progress work on something completely unrelated to the current task. Destroying them is irreversible.

## Never run these commands

- `git stash` to "test the original code" — use `git show HEAD:path/to/file` to read the original without touching the working tree
- `git checkout -- .` or `git restore .` — these wipe everything, including unrelated work
- `git add -A` or `git add .` — these stage everything, including files that shouldn't be committed. Always add specific files by name.
- `git push --force` to main/master — warn the user if they request this

## Safe alternatives

| Instead of | Use |
|------------|-----|
| `git stash` to compare with original | `git show HEAD:path/to/file` or `git diff HEAD -- path/to/file` |
| `git checkout -- file` to undo one file | Ask the user first — the change may be intentional |
| `git reset --hard` to undo a bad commit | `git reset --soft HEAD~1` (keeps changes staged) |
| `git add .` to stage everything | `git add file1 file2 file3` (name each file) |

## The safe pattern for undoing an accidental commit

1. `git status` — see everything in the working tree
2. `git reset --soft HEAD~1` — undo the commit, keep everything staged
3. `git reset HEAD -- <only the files from the bad commit>` — unstage just those
4. Leave everything else alone — don't touch files that weren't part of the problem

## When something unexpected happens

When a push fails, when you're on the wrong branch, when a file is missing — **stop and ask**. Do not improvise a fix. The unexpected state is probably intentional. The user manages their own git workflow.

## Never without explicit user request

- Create worktrees
- Switch or create branches
- Push to any remote
- Run any destructive command listed above

"Commit" does not mean "commit and push." Only push when the user says "push."
