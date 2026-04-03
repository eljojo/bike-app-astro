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

### Care through craft

The site should make people feel that we care, even if they can't put their finger on why. This means grounding visual decisions in color science and perceptual research, not in "what feels right" or AI-generated aesthetic clichés. Subliminal attention to gradients, depth cues, and spatial light is how you show care without announcing it.

### Restraint and warmth in equal measure

One accent color (orange). One transition timing language (five pairs, each for a purpose). One border radius (6px public, 3px tags). A serif/sans typography pairing that says "edited magazine" not "software dashboard." The restraint creates a canvas where the content — real photos from real rides, real routes ridden by real people — is the star.

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

The palette is grounded in CIELAB color science, not vibes. The "warm cream/sepia" direction (high positive b* axis) is an AI design cliché — physically repulsive when overused. Our warmth comes from a different axis entirely.

- **Dusk-shift foundations.** Slight cool (negative b*) combined with a whisper of rose (a* +0.5). This is the color of twilight — technically cool but perceptually soft. Light mode: `#fbfbfc` → `#f6f6f8`. Dark mode: `#0c0c0f` → `#08080b` (indigo-black, the sky 20 minutes after sunset).
- **Body backgrounds are vertical gradients** — lighter at top, deeper at bottom (2-3 CIELAB L* units). This mimics how natural light falls on a wall: brighter near the ceiling, settling into depth below. On a long page, the shift is imperceptible per screen but accumulates into a feeling of place. The gradient is the care.
- **Orange as the single accent.** Active tags, distance badges, nav highlights, seasonal banners, section underlines, active toggle states. Orange says "look here" without screaming. This is settled and works well.
- **Deep purple on maps.** `#350091` — unexpected, distinctive, slightly mysterious. Routes feel special against the terrain. This is a signature.
- **The gradient brand mark.** 45-degree blue-to-green on the site title. The one moment of visual flamboyance. Blue and green evoke water and nature — cycling territory.
- **Dusk darks, not cold ones.** Dark mode should feel like evening, not like a void. Cards at `#17171c` with a slight indigo tint. The indigo connects to the map's purple route lines. Both modes feel equally considered, equally alive.

## Typography

- **Merriweather (serif)** for headings — editorial authority, like a well-edited magazine.
- **Source Sans Pro (sans-serif)** for body — readable, modern, approachable.
- **American Typewriter (monospace)** for tags and badges — a tactile, label-maker quality. Distance badges and tags feel like stickers on a bulletin board.
- **Arial Black italic** for the site title — bold, distinctive, carries the gradient well.

## Interactions

### Transition timing language

Duration scales with distance. Easing matches the physics of the motion. Based on animation perception research (Card, Mack, & Robertson) and Disney's "slow in, slow out" principle.

- **State changes** (0.15s ease) — color, opacity, hover. State change, not motion.
- **Entrances** (0.2s ease-out) — popups appearing, elements revealing. Fast start = responsive, slow end = settles into place.
- **Exits** (0.15s ease-in) — elements leaving, closing. Don't make the user wait for something to leave.
- **Large movements** (0.35s ease-out) — map expansion, card transitions. Distance needs time to track visually.
- **Toggles** (0.15s ease-in-out) — tab switches, symmetric state changes between equal states.

### Card depth

Cards use `inset box-shadow` for pressed-in tactility — exploiting the light-from-above perceptual prior (Mamassian & Goutcher, 2001). Light: `inset 0 0 0 1px rgba(255,255,255,0.5)`. Dark: `inset 0 0 0 1px rgba(255,255,255,0.04)`. Images inside cards get `outline: 1px solid rgba(0,0,0,0.08); outline-offset: -1px` for a subtle inner frame. The combination creates a layered edge that reads as "crafted."

### Other patterns

- **Hover reveals.** The map card whispers "Tap to explore" on hover. It teaches the interaction without a tutorial.
- **Silent reordering.** Bookmarked routes and events float to the top without any "favorites mode" toggle. The site remembers what you cared about.
- **Daily rotation.** Homepage facts and community cards shuffle daily via seeded PRNG. Each visit feels slightly different — a living, breathing homepage — but within a day it's stable.

## Links

Four link types, each with clear affordance. Based on NNGroup research and WCAG 1.4.1: links in reading context must be visually self-evident without interaction.

- **Prose links** (in body text, markdown) — blue (`$color-link`) + styled underline (thin, offset, semi-transparent; thickens on hover). Always visible as links.
- **Sidebar/list links** (nearby places, paths, similar) — blue, no underline; underline appears on hover. Context (being in a list) provides affordance.
- **Action links** (view all, read more) — blue + `font-weight: 600`; underline on hover.
- **Navigation links** (top nav, breadcrumbs) — styled by context, no underline needed. Active state uses accent color.

No `:visited` color change — the site is a community noticeboard, not a research tool.

## Layout

- **85% content width** with auto margins. The 15% breathing room creates generous whitespace without a visible container.
- **Magazine grid** (3:2) for the wiki homepage. Featured content gets prominent real estate. Sidebar provides quick-scan supplementary content. Section headings have 2px orange underlines — visual anchors without full-width rules.
- **Mobile reordering via `display: contents`.** On mobile, two-column layouts flatten and interleave content in scroll-optimised order: map context first, then description, then actions. The order feels intentional, not like a sidebar dumped below.
- **Cards defined by subtle borders and background shift.** A thin border creates gentle containment; hover shifts the background or border color. The border should feel like a crease in paper, not a wireframe — `1px solid` in a muted tone, never heavy or dark.

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
