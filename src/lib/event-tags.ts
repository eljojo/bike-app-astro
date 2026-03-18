// src/lib/event-tags.ts
// Browser-safe — no .server imports, no node: APIs

export interface TagColor {
	lightBg: string;
	lightText: string;
	darkBg: string;
	darkText: string;
}

export const EVENT_TAG_SLUGS = ['social', 'group-ride', 'critical-mass', 'race', 'criterium', 'brevet', 'gran-fondo', 'gravel', 'charity-ride', 'workshop', 'festival', 'swap-meet', 'advocacy', 'tour', 'bikepacking', 'triathlon'] as const;

const TAG_COLORS: Record<string, TagColor> = {
	'social':        { lightBg: '#dbeafe', lightText: '#1e40af', darkBg: '#1e3a5f', darkText: '#93c5fd' },
	'group-ride':    { lightBg: '#dbeafe', lightText: '#1e40af', darkBg: '#1e3a5f', darkText: '#93c5fd' },
	'critical-mass': { lightBg: '#dbeafe', lightText: '#1e40af', darkBg: '#1e3a5f', darkText: '#93c5fd' },
	'race':          { lightBg: '#fee2e2', lightText: '#991b1b', darkBg: '#5f1e1e', darkText: '#fca5a5' },
	'criterium':     { lightBg: '#fee2e2', lightText: '#991b1b', darkBg: '#5f1e1e', darkText: '#fca5a5' },
	'brevet':        { lightBg: '#f3e8ff', lightText: '#6b21a8', darkBg: '#3b1e5f', darkText: '#d8b4fe' },
	'gran-fondo':    { lightBg: '#f3e8ff', lightText: '#6b21a8', darkBg: '#3b1e5f', darkText: '#d8b4fe' },
	'gravel':        { lightBg: '#e0e7ff', lightText: '#3730a3', darkBg: '#1e2a5f', darkText: '#a5b4fc' },
	'charity-ride':  { lightBg: '#dcfce7', lightText: '#166534', darkBg: '#1e3f2a', darkText: '#86efac' },
	'workshop':      { lightBg: '#fef9c3', lightText: '#854d0e', darkBg: '#3f3a1e', darkText: '#fde047' },
	'festival':      { lightBg: '#fef9c3', lightText: '#854d0e', darkBg: '#3f3a1e', darkText: '#fde047' },
	'swap-meet':     { lightBg: '#fef9c3', lightText: '#854d0e', darkBg: '#3f3a1e', darkText: '#fde047' },
	'advocacy':      { lightBg: '#ccfbf1', lightText: '#115e59', darkBg: '#1e3f3a', darkText: '#5eead4' },
	'tour':          { lightBg: '#ffe4e6', lightText: '#9f1239', darkBg: '#3f1e2a', darkText: '#fda4af' },
	'bikepacking':   { lightBg: '#e0f2fe', lightText: '#075985', darkBg: '#1e2f3f', darkText: '#7dd3fc' },
	'triathlon':     { lightBg: '#fff7ed', lightText: '#9a3412', darkBg: '#3f2a1e', darkText: '#fdba74' },
};

const FALLBACK: TagColor = { lightBg: '#f3f4f6', lightText: '#374151', darkBg: '#2a2a2a', darkText: '#d1d5db' };

export function tagPillColor(tag: string): TagColor {
	return TAG_COLORS[tag] ?? FALLBACK;
}

export type EventSection = 'seasonal' | 'community' | 'learn-connect' | 'general';

const COMMUNITY_TAGS = new Set(['social', 'group-ride', 'critical-mass']);
const LEARN_CONNECT_TAGS = new Set(['workshop', 'swap-meet', 'festival', 'advocacy', 'bikepacking']);

export function classifyEvent(tags: string[]): EventSection {
	if (tags.includes('seasonal')) return 'seasonal';
	if (tags.some(t => COMMUNITY_TAGS.has(t))) return 'community';
	if (tags.some(t => LEARN_CONNECT_TAGS.has(t))) return 'learn-connect';
	return 'general';
}
