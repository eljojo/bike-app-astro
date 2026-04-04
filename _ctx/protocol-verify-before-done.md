---
description: Run all verification commands, show output, never claim success without evidence
type: protocol
triggers: [about to claim work is done, finishing a task, before saying "done" or "fixed" or "works"]
related: [protocol-drift-correction, test-quality]
---

# Verify Before Done Protocol

A claim without evidence is a guess. AI is especially prone to confident guesses. If you say it works, show the output. If you say it's fixed, show the test passing.

## Before claiming any change is complete

1. **Grep for related terms.** Find every reference to what you changed: code, styles, translations, types, tests, build config. A change that compiles is not a change that's complete.

2. **Run `make lint`** — ESLint catches import boundary violations, missing authorize calls, and other structural rules. CI enforces this; don't skip it locally.

3. **Run `make typecheck`** — TypeScript catches type mismatches your editor might not show. A clean typecheck is the minimum bar.

4. **Run relevant tests.** If you touched code covered by unit tests, run `make test`. If you touched admin flows, run `make test-admin`. If you touched public pages, run `make test-e2e`. When unsure which tests are relevant, run more rather than fewer.

5. **Show the output.** Paste the actual command output. Not "it passes" — the output. The user should be able to see the proof without running anything.

## For bug fixes specifically

- **Show the test failing without your change.** If you can't demonstrate the test failing before and passing after, you can't be sure it's testing anything.
- **Break the code to verify the test.** Introduce a deliberate bug. If the test still passes, the test is worthless.

## For new features specifically

- **Trace all connections.** A new field means: schema, model, loader, virtual module type, cache parser, editor component, view template. Missing any one of these is an incomplete feature.
- **Check the build.** Run `make build` if the change affects static output. Build failures are not acceptable to discover in CI.

## What "done" means

- Lint passes
- Types check
- Relevant tests pass
- You showed the output of each verification step
- You grepped for related references and addressed them all

## What "done" does not mean

- "The logic looks correct" — your mental model is a theory, not evidence
- "It should work" — that's a prediction, not a verification
- "It compiled" — compilation is necessary but not sufficient
- "I don't see any issues" — absence of evidence is not evidence of absence

## Never claim something works based on

- Reading the code and tracing logic mentally
- Mocked tests passing (mocks test mock behavior, not application behavior)
- A single test case passing (what about edge cases?)
- "It worked last time" — things change between sessions
