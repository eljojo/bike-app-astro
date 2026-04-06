---
description: Light per-session and deep periodic maintenance of _ctx/ knowledge base — leave no broken windows
type: protocol
triggers: [finishing a branch, user asks to review ctx, starting a dreaming session, noticed a stale ctx file, changed code that a ctx file describes]
related: [context-system]
---

# Context Maintenance Protocol

## Broken Windows Principle

A stale file, a wrong reference, a section that no longer matches the code — these are broken windows. Each one teaches the next AI session that `_ctx/` can't be trusted. Once trust erodes, AI stops reading carefully, starts skimming, makes decisions without context. The whole system fails.

**Leave no broken windows unnoticed.** Fix them immediately, even if unrelated to the current task.

## Light Maintenance (Every Session)

This isn't a separate step — it's part of the work, like updating tests when you change behavior.

### When you changed something a file documents

Update the `_ctx/` file in the same commit as the code change. A file that describes yesterday's code is a broken window.

### When you discovered something non-obvious

Something that took investigation, surprised you, or would trip up the next AI session. If it fits in an existing file, add it there. If it's a new topic, tell the user — they decide whether it becomes a new file.

### When you noticed a file is wrong

Fix it immediately. Don't leave it for the next session. Don't leave a mental note. Fix it now.

### What to look for

- Functions, files, or patterns mentioned by name that no longer exist
- Descriptions of behavior that has changed
- Examples using outdated API or syntax
- Cross-references (`related:` field) pointing to deleted files
- Sections that duplicate what AGENTS.md already says inline

## Deep Review ("Dreaming")

A dedicated session for reviewing the entire knowledge base. Kick off when:
- Finishing a development branch with significant changes
- The user asks for a ctx review
- It's been many sessions since the last review

### The Process

1. **Read every `_ctx/` file.** All of them, not just the ones that seem relevant to recent work.

2. **Verify against current code.** For each file:
   - Grep for specific function names, file paths, and patterns it mentions
   - Do they still exist? Do they still work as described?
   - Does the file's description match what the code actually does?

3. **Check for staleness.**
   - Has the code moved past what the file describes?
   - Has a pattern changed since the file was written?
   - Has a gotcha been fixed?
   - Has a rule been relaxed or tightened?

4. **Check for gaps.**
   - Are there important systems with no `_ctx/` coverage?
   - Look at recent git history — what significant work happened since the last review?
   - Are there decisions or patterns that keep surprising AI sessions?

5. **Check for redundancy.**
   - Do two files cover the same ground?
   - Can sections be merged?
   - Does a file repeat what AGENTS.md already says inline?

6. **Check for noise.**
   - Does every sentence earn its place?
   - Could a paragraph be a sentence?
   - Could a section be cut without losing signal?
   - Remember: signal density determines whether AI absorbs or skims.

7. **Check for broken windows.**
   - Wrong references, outdated examples, dead links
   - Types or categories that no longer fit
   - Descriptions that are misleading

8. **Check AGENTS.md index.**
   - Are one-line descriptions still accurate?
   - Are files in the right category?
   - Is anything missing from the index?

9. **Propose changes.** Present a summary to the user:
   - Files to update (with what changed)
   - Files to merge (with reasoning)
   - Files to delete (with reasoning)
   - Gaps to fill (with proposed new files)
   - Get user approval before executing.

### After a Deep Review

Update `context-system.md` with the date of last review if it tracks that. Commit all changes as one coherent commit: `chore: _ctx/ deep review — [brief summary of changes]`.
