---
description: Public site design — the iPod for cycling; accessible, curious, warm; restraint and vibrancy in balance
type: guide
triggers: [designing public pages, adding components, styling public views, working on homepage, map interactions, route cards]
related: [voice-and-feel, brand-framing, admin-design-language, css-styling]
---

# Public Design Language

## The Bicycle for Your Body

The computer was the bicycle for the mind — it amplified human thinking. The actual bicycle amplifies human movement, human freedom, human connection to place. This app is where the two meet: the bicycle for the mind, in service of the bicycle for the body.

When humans embrace bikes, we get superpowers. Not the competitive, athletic, top-1% kind. The everyday kind. The kind where you discover that the bakery at kilometre four has been there your whole life and you never knew. The kind where a twelve-kilometre ride along the river changes how you feel about your city.

The public site is an invitation to discover that you already have these superpowers. You just need to get on a bike.

## The Feeling

This is the iPod of cycling apps. Simple enough that your mom picks it up. Exciting enough that you want to show your friends. Not intimidating, not competitive, not covered in heart rate zones and power metrics. This is cycling as part of life — something accessible that everyone does, and you can too.

The site should make you curious. You should want to scroll, to click a route, to see what's around the corner on the map. Not because we tricked you with engagement patterns, but because the content is genuinely interesting and the interface gets out of the way just enough to let you feel that.

## Design Principles

### Restraint and warmth in equal measure

One accent color (orange). One animation speed (0.15s). One tiny border radius (3px). A serif/sans typography pairing that says "edited magazine" not "software dashboard." The restraint creates a canvas where the content — real photos from real rides, real routes ridden by real people — is the star.

But restraint doesn't mean cold. Orange is warm and energetic. The site title shimmers with a blue-to-green gradient. Emoji serve as place markers. The weather card appears on good days as a gentle nudge. Warmth lives in the details.

### Progressive revelation

Pages feel simple on arrival but deep on exploration. Photo galleries show nine images, then a "Show all" button. Nearby places show eight, then more. Past events hide behind a toggle. The weather card loads asynchronously and only appears when it has something to say.

Nothing is hidden permanently — it's all one click away. The site respects your attention by not demanding it all at once.

### Physical metaphors

The expanding map card mimics picking up a physical card and holding it closer — it animates from its exact position, the background darkens like the room behind it, and it settles into focus. Photos on maps are circular bubbles with white borders, like polaroid cutouts pinned to a landscape. The touch lock on mobile maps respects the physical gesture (vertical scroll) while keeping the map accessible.

Digital interfaces work best when they remind you of something your hands already understand.

### The map is the territory

Maps aren't illustrations — they're the primary navigation tool. The big map page dissolves the site header into a gradient that fades to nothing, making the map the entire experience. Route polylines in deep purple (#350091) are unexpected and distinctive. Photo bubbles grow as you zoom in, revealing detail like approaching a place on a ride. Popups surface gently from below, as if the information is rising to meet you.

### Community presence, not user metrics

Reactions say "I've ridden this" — not "liked" or "viewed." Starred routes float silently to the top of listings. Guest accounts are created invisibly when someone reacts. A trust receipt auto-dismisses after four seconds. The site trusts you first and explains after.

This is a community noticeboard maintained by people who ride these roads, not a platform optimising for engagement.

## The Palette

The palette is evolving. The current black-on-white foundation is functional but doesn't yet have the warmth the site deserves. The direction:

- **Warm foundations, not stark ones.** The site should feel like paper that's been in the sun, not like a screen. Light mode wants warmth — not white, but something with life. Dark mode wants depth — not black, but the sky just after sunset when you're riding home. The current `#000`/`#fff` is a starting point, not the destination.
- **Orange as the single accent.** Active tags, distance badges, nav highlights, seasonal banners, section underlines. Orange says "look here" without screaming. This is settled and works well.
- **Deep purple on maps.** `#350091` — unexpected, distinctive, slightly mysterious. Routes feel special against the terrain. This is a signature.
- **The gradient brand mark.** 45-degree blue-to-green on the site title. The one moment of visual flamboyance. Blue and green evoke water and nature — cycling territory.
- **Warm darks, not cold ones.** Dark mode should feel like evening, not like a void. Cards at `#141414` are close but could be warmer. The goal: both modes feel equally considered, equally alive.

## Typography

- **Merriweather (serif)** for headings — editorial authority, like a well-edited magazine.
- **Source Sans Pro (sans-serif)** for body — readable, modern, approachable.
- **American Typewriter (monospace)** for tags and badges — a tactile, label-maker quality. Distance badges and tags feel like stickers on a bulletin board.
- **Arial Black italic** for the site title — bold, distinctive, carries the gradient well.

## Interactions

- **0.15 seconds** is the universal transition speed. Card hovers, button states, photo opacity, popup entrances. Fast enough to feel instant, slow enough for the eye to register. Consistency creates a unified feel — the whole site has one speed of responsiveness.
- **0.35 seconds** for large movements (map card expansion) — big movements need more time to track visually.
- **Hover reveals.** The map card whispers "Tap to explore" on hover. It teaches the interaction without a tutorial.
- **Silent reordering.** Bookmarked routes and events float to the top without any "favorites mode" toggle. The site remembers what you cared about.
- **Daily rotation.** Homepage facts and community cards shuffle daily via seeded PRNG. Each visit feels slightly different — a living, breathing homepage — but within a day it's stable.

## Layout

- **85% content width** with auto margins. The 15% breathing room creates generous whitespace without a visible container.
- **Magazine grid** (3:2) for the wiki homepage. Featured content gets prominent real estate. Sidebar provides quick-scan supplementary content. Section headings have 2px orange underlines — visual anchors without full-width rules.
- **Mobile reordering via `display: contents`.** On mobile, two-column layouts flatten and interleave content in scroll-optimised order: map context first, then description, then actions. The order feels intentional, not like a sidebar dumped below.
- **Cards defined by background shift, never by borders.** Barely-gray cards create containment without boxing things in. Hover shifts the background. No visible borders.

## Photography

- **`object-position: center bottom`** for gallery thumbnails — a cycling-specific choice. Landscape photos of trails and roads have the subject in the lower portion.
- **1:1 crop on desktop, full-width on mobile.** Desktop creates a clean mosaic; mobile lets each photo breathe.
- **The first gallery photo is hidden on mobile** because the cover photo already shows it. Attention to the actual viewing experience.

## Accessibility Without Announcing It

- Emoji as universal interface elements — understood across languages and cultures.
- Schema.org structured data on every content page — invisible investment in discoverability.
- iCal feeds and RSS — the site meets people where they are.
- Progressive enhancement everywhere — the page renders fast, then gets richer.
- Touch lock on mobile maps — respects the primary gesture (vertical scroll).

## What This Is Not

- Not a sports app. No heart rate zones, no Strava segments, no leaderboards.
- Not a utility. Not "directions from A to B." It's "here's somewhere worth going."
- Not a platform. No algorithmic feed, no engagement optimisation, no notification badges.
- Not intimidating. If someone Googling "bike rides near me" lands here, they should feel welcome, not out of their depth.

It's a community noticeboard with good typography, maintained by people who ride these roads and want you to enjoy them too.
