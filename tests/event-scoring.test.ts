import { describe, it, expect } from 'vitest';
import {
	scoreEvent,
	tagScore,
	timeScore,
	TAG_SCORES,
	BASELINE_TAG_SCORE,
	TIME_PEAK,
	TIME_FLOOR,
	SERIES_PENALTY,
} from '../src/lib/event-scoring';

// Local midnight to align with parseLocalDate (which produces local midnight).
// Avoids TZ drift in daysUntil arithmetic.
const NOW = new Date(2026, 3, 28);

describe('tagScore', () => {
	it('returns max across tags, not sum', () => {
		// women-only (30) + social (10) — max wins, not 40
		expect(tagScore(['women-only', 'social'])).toBe(30);
	});

	it('falls back to baseline for empty tags', () => {
		expect(tagScore([])).toBe(BASELINE_TAG_SCORE);
	});

	it('falls back to baseline for unknown tags', () => {
		expect(tagScore(['race', 'criterium', 'time-trial'])).toBe(BASELINE_TAG_SCORE);
	});

	it('canonicalises synonyms via TAG_SYNONYMS', () => {
		// youth → family-friendly = 25
		expect(tagScore(['youth'])).toBe(25);
		// social-ride → social = 15
		expect(tagScore(['social-ride'])).toBe(15);
		// group-ride → social = 15
		expect(tagScore(['group-ride'])).toBe(15);
	});

	it('matches the documented tag table', () => {
		expect(TAG_SCORES['women-only']).toBe(30);
		expect(TAG_SCORES['festival']).toBe(30);
		expect(TAG_SCORES['family-friendly']).toBe(25);
		expect(TAG_SCORES['workshop']).toBe(20);
		expect(TAG_SCORES['slow-riding']).toBe(20);
		expect(TAG_SCORES['charity-ride']).toBe(20);
		expect(TAG_SCORES['advocacy']).toBe(15);
		expect(TAG_SCORES['social']).toBe(15);
		expect(TAG_SCORES['bikepacking']).toBe(20);
		expect(TAG_SCORES['brevet']).toBe(20);
	});
});

describe('timeScore', () => {
	it('peaks today', () => {
		expect(timeScore('2026-04-28', NOW)).toBeCloseTo(TIME_PEAK, 0);
	});

	it('decays linearly: 21 at 30 days, 12 at 60 days', () => {
		expect(timeScore('2026-05-28', NOW)).toBeCloseTo(21, 5);
		expect(timeScore('2026-06-27', NOW)).toBeCloseTo(12, 5);
	});

	it('floors at TIME_FLOOR for far-future events', () => {
		expect(timeScore('2026-08-16', NOW)).toBe(TIME_FLOOR);
		expect(timeScore('2027-04-28', NOW)).toBe(TIME_FLOOR);
	});

	it('caps at TIME_PEAK for past dates (defensive)', () => {
		// Scoring is called after upcoming-filtering so this should never happen,
		// but the clamp keeps the score sane if it does.
		expect(timeScore('2026-04-01', NOW)).toBe(TIME_PEAK);
	});
});

describe('scoreEvent — worked examples from the design spec', () => {
	it('Black Girls Biking First Ride (May 9, featured org, women-only)', () => {
		const score = scoreEvent({
			tags: ['social', 'women-only'],
			isSeries: false,
			organizerFeatured: true,
			effectiveDate: '2026-05-09',
			now: NOW,
		});
		// 30 (women-only) + 40 (featured) + 26.7 (11 days out) = 96.7
		expect(score).toBeCloseTo(96.7, 1);
	});

	it('OttBike Social weekly (featured org, series, slow-riding)', () => {
		const score = scoreEvent({
			tags: ['group-ride', 'slow-riding', 'social'],
			isSeries: true,
			organizerFeatured: true,
			effectiveDate: '2026-04-30',
			now: NOW,
		});
		// 20 (slow-riding) + 40 (featured) + 29.4 (2 days) + 0 (no penalty for featured series) = 89.4
		expect(score).toBeCloseTo(89.4, 1);
	});

	it('Coffee Outside Mommas (May 10, featured org, slow-riding)', () => {
		const score = scoreEvent({
			tags: ['social', 'slow-riding'],
			isSeries: false,
			organizerFeatured: true,
			effectiveDate: '2026-05-10',
			now: NOW,
		});
		// 20 (slow-riding) + 40 (featured) + 26.4 (12 days) = 86.4
		expect(score).toBeCloseTo(86.4, 1);
	});

	it('100% Féminin (Aug 16, inline org, women-only)', () => {
		const score = scoreEvent({
			tags: ['road', 'gravel', 'women-only'],
			isSeries: false,
			organizerFeatured: false,
			effectiveDate: '2026-08-16',
			now: NOW,
		});
		// 30 (women-only) + 0 + 5 (floor, 110 days out) = 35
		expect(score).toBe(35);
	});

	it('BMX Open House (May 9, NOT featured, family-friendly)', () => {
		const score = scoreEvent({
			tags: ['bmx', 'family-friendly'],
			isSeries: false,
			organizerFeatured: false,
			effectiveDate: '2026-05-09',
			now: NOW,
		});
		// 25 (family-friendly) + 0 + 26.7 = 51.7
		expect(score).toBeCloseTo(51.7, 1);
	});

	it('OBC Sunday Practice — non-featured weekly series gets penalty', () => {
		const score = scoreEvent({
			tags: ['social'],
			isSeries: true,
			organizerFeatured: false,
			effectiveDate: '2026-05-03',
			now: NOW,
		});
		// 15 (social) + 0 + 28.5 (5 days) + (-10) penalty = 33.5
		expect(score).toBeCloseTo(33.5, 1);
	});

	it('non-featured race 4 weeks out (no boost, no penalty)', () => {
		const score = scoreEvent({
			tags: ['race'],
			isSeries: false,
			organizerFeatured: false,
			effectiveDate: '2026-05-26',
			now: NOW,
		});
		// 5 (baseline) + 0 + 21.6 = 26.6
		expect(score).toBeCloseTo(26.6, 1);
	});
});

describe('scoreEvent — imminent race bonus', () => {
	it('adds +20 to a race within 3 days', () => {
		const todayRace = scoreEvent({
			tags: ['race'],
			isSeries: false,
			organizerFeatured: false,
			effectiveDate: '2026-04-28',
			now: NOW,
		});
		// 5 (baseline) + 0 + 30 (today) + 15 (imminent) = 50
		expect(todayRace).toBe(50);

		const threeDayRace = scoreEvent({
			tags: ['race'],
			isSeries: false,
			organizerFeatured: false,
			effectiveDate: '2026-05-01',
			now: NOW,
		});
		// 5 + 0 + 29.1 + 15 = 49.1
		expect(threeDayRace).toBeCloseTo(49.1, 1);
	});

	it('does NOT add the bonus once the race is more than 3 days out', () => {
		const fourDayRace = scoreEvent({
			tags: ['race'],
			isSeries: false,
			organizerFeatured: false,
			effectiveDate: '2026-05-02',
			now: NOW,
		});
		// 5 (baseline) + 0 + 28.8 + 0 = 33.8 — well below featured-org events
		expect(fourDayRace).toBeCloseTo(33.8, 1);
	});

	it('applies to the whole race family (criterium, time-trial, triathlon)', () => {
		for (const tag of ['criterium', 'time-trial', 'triathlon']) {
			const score = scoreEvent({
				tags: [tag],
				isSeries: false,
				organizerFeatured: false,
				effectiveDate: '2026-04-30',
				now: NOW,
			});
			// 5 + 0 + 29.4 + 15 = 49.4
			expect(score).toBeCloseTo(49.4, 1);
		}
	});

	it('does not apply to non-race tags', () => {
		const todayWorkshop = scoreEvent({
			tags: ['workshop'],
			isSeries: false,
			organizerFeatured: false,
			effectiveDate: '2026-04-28',
			now: NOW,
		});
		// 20 (workshop) + 0 + 30 + 0 (no imminent boost) = 50
		expect(todayWorkshop).toBe(50);
	});
});

describe('scoreEvent — series penalty logic', () => {
	it('applies -10 only when series AND not featured', () => {
		const base = {
			tags: ['social'],
			effectiveDate: '2026-05-03',
			now: NOW,
		};
		const featuredSeries = scoreEvent({ ...base, isSeries: true, organizerFeatured: true });
		const featuredOneOff = scoreEvent({ ...base, isSeries: false, organizerFeatured: true });
		const nonFeaturedSeries = scoreEvent({ ...base, isSeries: true, organizerFeatured: false });
		const nonFeaturedOneOff = scoreEvent({ ...base, isSeries: false, organizerFeatured: false });

		// Featured series: no penalty (curated content)
		expect(featuredSeries).toBe(featuredOneOff);
		// Non-featured series: penalty applied
		expect(nonFeaturedSeries).toBe(nonFeaturedOneOff - SERIES_PENALTY);
	});
});
