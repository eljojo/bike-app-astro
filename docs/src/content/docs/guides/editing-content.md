---
title: Editing content
description: How to edit routes and events, work with translations, and use version history.
sidebar:
  badge:
    text: Everyone
    variant: tip
---

Every page on the site can be improved. Fix a typo, update a description, add missing details — the site gets better with every edit.

## The editor

Route and event editors work the same way. You'll see a form with the page's current content. Make your changes, tap **Save**, and your edits go live after the next site rebuild.

Descriptions support Markdown formatting — headings, bold, italic, links, and lists. A **formatting help** link in the editor points to a quick reference.

## Tags

Route tags help riders find what they're looking for. The tag input suggests existing tags as you type, so the site stays consistent.

- Type a tag name and press **Enter** or **comma** to add it.
- Tap the **x** on a tag to remove it.

Use the tags that already exist when possible. Common tags include surface types, features, and difficulty indicators.

## Translations

The site supports English and French. In the route editor, you'll see tabs at the top for each language.

- **English** is the default. Fill in the name, tagline, and description in English.
- **French** tab shows the same fields for the French translation. Leave blank if you don't have a translation — the English version will be used.

Each language is saved independently. You can translate a route without affecting the English version, and vice versa.

## Version history

Below every editor, you'll find the edit history — a list of every change made to that page, newest first.

Each entry shows:
- What was changed (the commit message)
- Who made the change
- When it happened

### View a diff

Tap **Diff** on any history entry to see exactly what changed — additions, removals, and modifications displayed line by line. Tap **Hide diff** to collapse it.

### Restore a previous version

:::caution[Admin only]
Only admins can restore previous versions.
:::

If an edit introduced a problem, tap **Restore** on the version you want to go back to. This creates a new edit that reverts the content to that point in time — the original edit stays in the history for transparency.

## Saving

When you save:

- The editor checks that required fields are filled in (like the route name).
- If someone else edited the same page since you opened it, you'll see a conflict notice. Open the page in a new tab to see their changes, then try again.
- A confirmation message appears when the save succeeds. Your changes will be live within a few minutes.

All edits are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), the same license Wikipedia uses. A note at the bottom of the editor reminds you of this.
