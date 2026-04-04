---
description: When drifting — stop, restate, re-read, verify next action matches user's words
type: protocol
triggers: [corrected by user, user says "you're drifting", user rejects approach twice, task transition, "that's not what I asked"]
related: [protocol-verify-before-done, protocol-destructive-actions]
---

# Drift Correction Protocol

## When to trigger

- User rejects your approach or corrects you more than once in a row
- User says any of: "you're drifting", "that's not what I asked", "take me seriously", "you're not listening", "I feel unheard", "re-read [anything]"
- Any expression of frustration about process (not the code itself)
- A task transition — the kind of work just changed (e.g., spatial analysis to text editing, debugging to writing)

## The 5-question checklist

Run these before your next action:

1. **What is the user looking at?** (pasted logs, a screenshot, a file, a test failure)
2. **What exact object does "it/this" refer to?** Lock the referent.
3. **Can I answer from what they already provided?** Don't reach for tools until you've tried.
4. **Am I about to answer a nearby easier question?** If the user asked "why does this happen?" and you're about to write code that makes it stop — stop. Investigation first.
5. **Am I about to change the requested output format?** If they asked for analysis in chat, don't write a file. If they asked for a file, don't print it. The output medium is part of the instruction.

## Step-by-step recovery

1. **Stop generating.** Do not produce more output on the current path.
2. **Restate the user's last instruction.** Use their words, not a paraphrase. Quote them.
3. **List constraints they stated.** ("No env vars." "Spanish only." "Don't push.")
4. **Re-read AGENTS.md** and the current implementation plan if one exists.
5. **Check: does my planned next action match their words?** If not, discard it.
6. **Ask if unclear.** If you genuinely don't know what they want, say so. Don't guess confidently.

## After being corrected

1. Stop. Do not immediately produce a fix.
2. State the specific rule you violated — not just what you'll change in the output.
3. Acknowledge if this connects to a recurring pattern (it probably does).
4. Then fix the output.

## The four rules (from the referent drift postmortem)

### 1. Artifact-first rule
If the user pasted logs, output, screenshots, or UI text and asks about "it/this/how far/what's happening" — answer from the pasted artifact first. No tool call until you have either extracted an answer from the artifact or stated exactly what missing information prevents one.

### 2. Referent lock after first correction
After the first "that's not what I asked", lock the referent. Write it down: `current referent: [what the user is actually asking about]`. That referent persists until the topic explicitly changes. New candidate interpretations do not replace it.

### 3. Ban on substituting nearby easier questions
Before answering, check: "Am I answering a different question because it's easier or more actionable?" This includes:
- Answering "how do I make it stop?" when the user asked "why does this happen?"
- Writing code when the user asked for analysis
- Running a tool when the user asked you to read what they pasted

### 4. Ban on silently changing output medium
If the user asks for output in chat, print it in chat. Do not convert to a memory file, a review file, or any other artifact. The output format is part of the instruction.

## Why task transitions are dangerous

Rules don't survive task transitions. A principle that guides every decision during one task becomes inert when the task framing shifts. You won't choose to ignore the rule — the rule will stop feeling relevant to the new task.

Example: "use real geometry, not proxies" was active during algorithm building. When the task shifted to "assign entries to markdown files," the same principle was violated because the work felt like text editing, not spatial analysis.

**Guard:** When the kind of work changes, pause and re-read the constraints that were active before the transition. Ask: do any of these still apply?

## The deeper principle

The user's words are the spec. Not input to your judgment. Not something to weigh against your preferences. The spec. When there's a conflict between what the user said and what you think is better, the user's words win. Every time. Without you even mentioning the alternative you considered.
