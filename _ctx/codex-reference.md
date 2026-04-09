---
description: How to use Codex (OpenAI) for second opinions, debugging, and review — always loaded
type: knowledge
triggers: [stuck on a problem, debugging platform issues, wanting a second opinion, going in circles]
related: []
---

# Codex Reference

## When to Use

- Debugging platform-level issues (signal handling, child processes, OS behavior) where Claude tends to guess wrong
- Going in circles on a problem — a fresh perspective from a different model breaks the loop
- Wanting a second opinion on an approach before committing to it
- Code review of your own changes

Use proactively. Don't wait for the user to suggest it.

## How to Invoke

All commands must run inside `nix develop`.

### Non-interactive (dispatch from Claude)

```sh
nix develop --command bash -c "npx @openai/codex exec \
  -c 'sandbox_permissions=[\"disk-full-read-access\", \"disk-write-access\"]' \
  'Describe the problem here. List files to read. Say what was tried. Say DO NOT commit.'"
```

### Interactive (user runs in terminal)

Suggest the user type `! nix develop --command bash -c "npx @openai/codex"` to open the TUI.

## Key Flags

- `exec` — non-interactive mode, runs to completion, no TUI
- `-c 'sandbox_permissions=[...]'` — grant file read/write access
- Omit `--model` flag — uses best available default. Never use o4-mini for important work.
- `-q` — quiet mode (less output)

## The Pattern for Dispatching

When dispatching from Claude:

1. **Describe the problem precisely** — what's happening, what should happen
2. **List files to read** — give exact paths
3. **Say what was already tried** — prevent it from repeating failed approaches
4. **Always include "DO NOT commit"** — changes should be reviewed first
5. **Include "DO NOT run make or npm commands"** — prevent build side effects

## What It's Not

Codex is a tool, not a replacement for thinking. Use it for verification and fresh perspectives. Don't dispatch it for tasks you haven't thought through yourself first.
