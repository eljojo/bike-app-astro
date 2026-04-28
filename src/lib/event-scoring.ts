// src/lib/event-scoring.ts
// Browser-safe — no .server imports, no node: APIs
//
// Scores upcoming events for the three featured strips on /calendar
// ("Find your people", "Learn & connect", "Coming up"). The classification
// into strips is unchanged — see classifyEvent in event-tags.ts. Scoring
// only decides who fills each strip, not which strip an event lands in.
//
// Tunable constants are exported so they can be adjusted in one place.
// See docs/plans/2026-04-28-calendar-event-scoring-design.md.

import { parseLocalDate } from './date-utils';
import { canonicalTag } from './event-tags';

export const TAG_SCORES: Record<string, number> = {
	'women-only': 30,
	'festival': 30,
	'swap-meet': 30,
	'critical-mass': 30,
	'family-friendly': 25,
	'workshop': 20,
	'slow-riding': 20,
	'charity-ride': 20,
	'brevet': 20,
	'bikepacking': 20,
	'advocacy': 15,
	'meetup': 15,
	'social': 15,
	'tour': 5,
	'gran-fondo': 5,
};

export const BASELINE_TAG_SCORE = 5;
export const FEATURED_BONUS = 40;

// Soft-featured: organizers carrying one of these tags get a partial
// featured bonus. Lets us boost specific kinds of community work
// (storytelling, advocacy archives, etc.) without committing to the
// full "we vouch for everything they do" signal of featured: true.
export const SOFT_FEATURED_ORG_TAGS = new Set(['storytelling', 'advocacy']);
export const SOFT_FEATURED_BONUS = 25;
export const TIME_PEAK = 30;
export const TIME_FLOOR = 5;
export const TIME_DECAY_PER_DAY = 0.3;
export const SERIES_PENALTY = 10;

// Imminent-event boost: act-now events (races, meetups) get a bump within
// a few days. Without this, races fall to baseline (+5) and meetups don't
// rise above other social events when they're tomorrow vs next month.
const IMMINENT_TAGS = new Set(['race', 'criterium', 'time-trial', 'triathlon', 'meetup']);
export const IMMINENT_BONUS = 15;
export const IMMINENT_DAYS = 3;

// Rarity boost: an organizer running ~one event a year deserves more
// surface than a club running weekly practices. Rate is total events for
// this organizer divided by the number of distinct calendar years they
// appear in — stable across the year (unlike a current-year-only count
// which would call every January "rare"). Inline organizers (no record)
// are treated as 1 event / 1 year = 1.0.
export const RARITY_TIERS: ReadonlyArray<{ maxRate: number; bonus: number }> = [
	{ maxRate: 1.0, bonus: 30 },
	{ maxRate: 2.0, bonus: 20 },
	{ maxRate: 3.0, bonus: 10 },
];

// Repeat-organizer penalty: when picking the top N for a strip, only the
// soonest event per organizer competes at full score. Others get this
// penalty so one organizer can't monopolize multiple slots. Applied at
// the call site (calendar.astro) because it depends on what's in the pool.
export const ORGANIZER_REPEAT_PENALTY = 30;

export interface ScoringInputs {
	tags: string[];
	isSeries: boolean;
	organizerFeatured: boolean;
	/** Organizer carries a SOFT_FEATURED_ORG_TAGS tag. Ignored if organizerFeatured. */
	organizerSoftFeatured: boolean;
	/** Average events per active year for this organizer. 1.0 for inline organizers. */
	organizerEventsPerYear: number;
	/** YYYY-MM-DD — next occurrence for series, start_date for one-offs */
	effectiveDate: string;
	now: Date;
}

export function tagScore(tags: string[]): number {
	let max = BASELINE_TAG_SCORE;
	for (const raw of tags) {
		const value = TAG_SCORES[canonicalTag(raw)] ?? BASELINE_TAG_SCORE;
		if (value > max) max = value;
	}
	return max;
}

export function timeScore(effectiveDate: string, now: Date): number {
	const daysUntil = (parseLocalDate(effectiveDate).getTime() - now.getTime()) / 86400000;
	const raw = TIME_PEAK - daysUntil * TIME_DECAY_PER_DAY;
	return Math.min(TIME_PEAK, Math.max(TIME_FLOOR, raw));
}

export function imminentBonus(tags: string[], effectiveDate: string, now: Date): number {
	if (!tags.some(t => IMMINENT_TAGS.has(canonicalTag(t)))) return 0;
	const daysUntil = (parseLocalDate(effectiveDate).getTime() - now.getTime()) / 86400000;
	return daysUntil >= 0 && daysUntil <= IMMINENT_DAYS ? IMMINENT_BONUS : 0;
}

export function rarityBonus(organizerEventsPerYear: number): number {
	for (const { maxRate, bonus } of RARITY_TIERS) {
		if (organizerEventsPerYear <= maxRate) return bonus;
	}
	return 0;
}

export function scoreEvent(inputs: ScoringInputs): number {
	const tag = tagScore(inputs.tags);
	const featured = inputs.organizerFeatured ? FEATURED_BONUS
		: inputs.organizerSoftFeatured ? SOFT_FEATURED_BONUS
		: 0;
	const time = timeScore(inputs.effectiveDate, inputs.now);
	const series = inputs.isSeries && !inputs.organizerFeatured ? -SERIES_PENALTY : 0;
	const imminent = imminentBonus(inputs.tags, inputs.effectiveDate, inputs.now);
	const rarity = rarityBonus(inputs.organizerEventsPerYear);
	return tag + featured + time + series + imminent + rarity;
}
