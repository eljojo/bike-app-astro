---
description: Stats show community relationship, not performance — "this is liked" not "this performs"
type: vision
triggers: [working on stats, analytics dashboard, engagement scoring, writing stats copy, adding metrics]
related: [voice-and-feel, development-principles]
---

# Stats Philosophy

## "This is liked" not "this performs"

Stats in this app show the community's relationship with content, not content performance. The distinction matters for every label, every insight sentence, and every metric we choose to display.

- **Community signal, not performance metric.** A route with high engagement is one the community values — not one that "performs well." The framing shapes how contributors feel about their work.
- **Descriptive, not prescriptive.** Stats describe what happened ("12 people rode this route last month"). They don't prescribe what to do ("optimize your route description for more views").
- **No gamification language.** No "top performing," no "underperforming," no "boost your reach." The dashboard is a window into community activity, not a leaderboard.

## Narrative Voice in Stats

The narrative module (`src/lib/stats/narrative.ts`) states facts and provides context. It never interprets visitor intent.

- Good: "This route has been viewed 340 times and 28 people marked it as ridden."
- Bad: "This route shows strong engagement signals suggesting planning behavior."

A test enforces this — the narrative output must not contain words like "planning," "sticky," or "signal."

## Insight Categories

- **Hidden gems** — routes the community likes but few have found yet
- **Needs work** — routes with traffic but low engagement (maybe the description needs updating)
- **Strong performers** — well-visited and well-loved (but we don't call them that in the UI)

Minimum thresholds: 10 views, 30s duration. Below that, we don't generate insights — the sample is too small to mean anything.
