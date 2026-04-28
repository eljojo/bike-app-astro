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
export const TIME_PEAK = 30;
export const TIME_FLOOR = 5;
export const TIME_DECAY_PER_DAY = 0.3;
export const SERIES_PENALTY = 10;

// Imminent-race boost: a race two days out is more pressing than a workshop
// next month. Without this, race-family tags fall to baseline (+5) and lose
// to almost any welcoming event regardless of timing.
const RACE_TAGS = new Set(['race', 'criterium', 'time-trial', 'triathlon']);
export const IMMINENT_RACE_BONUS = 15;
export const IMMINENT_RACE_DAYS = 3;

export interface ScoringInputs {
	tags: string[];
	isSeries: boolean;
	organizerFeatured: boolean;
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

export function imminentRaceBonus(tags: string[], effectiveDate: string, now: Date): number {
	if (!tags.some(t => RACE_TAGS.has(canonicalTag(t)))) return 0;
	const daysUntil = (parseLocalDate(effectiveDate).getTime() - now.getTime()) / 86400000;
	return daysUntil >= 0 && daysUntil <= IMMINENT_RACE_DAYS ? IMMINENT_RACE_BONUS : 0;
}

export function scoreEvent(inputs: ScoringInputs): number {
	const tag = tagScore(inputs.tags);
	const featured = inputs.organizerFeatured ? FEATURED_BONUS : 0;
	const time = timeScore(inputs.effectiveDate, inputs.now);
	const series = inputs.isSeries && !inputs.organizerFeatured ? -SERIES_PENALTY : 0;
	const imminent = imminentRaceBonus(inputs.tags, inputs.effectiveDate, inputs.now);
	return tag + featured + time + series + imminent;
}
