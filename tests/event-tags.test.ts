import { describe, it, expect } from 'vitest';
import { tagPillColor, classifyEvent } from '../src/lib/event-tags';

describe('tagPillColor', () => {
	it('returns community colors for social tag', () => {
		const color = tagPillColor('social');
		expect(color.lightBg).toBe('#dbeafe');
	});

	it('returns fallback for unknown tag', () => {
		const color = tagPillColor('unknown-tag');
		expect(color.lightBg).toBe('#f3f4f6');
	});

	it('uses first tag when given array', () => {
		const color = tagPillColor('brevet');
		expect(color.lightBg).toBe('#f3e8ff');
	});
});

describe('classifyEvent', () => {
	it('classifies seasonal events', () => {
		expect(classifyEvent(['seasonal', 'advocacy'])).toBe('seasonal');
	});

	it('classifies community events', () => {
		expect(classifyEvent(['social'])).toBe('community');
		expect(classifyEvent(['group-ride'])).toBe('community');
		expect(classifyEvent(['critical-mass'])).toBe('community');
	});

	it('classifies learn-connect events', () => {
		expect(classifyEvent(['workshop'])).toBe('learn-connect');
		expect(classifyEvent(['swap-meet'])).toBe('learn-connect');
		expect(classifyEvent(['bikepacking'])).toBe('learn-connect');
	});

	it('returns general for unclassified tags', () => {
		expect(classifyEvent(['race'])).toBe('general');
		expect(classifyEvent(['brevet'])).toBe('general');
	});

	it('prioritizes seasonal over other classifications', () => {
		expect(classifyEvent(['seasonal', 'social'])).toBe('seasonal');
	});
});
