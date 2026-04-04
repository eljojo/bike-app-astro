const SURFACE_PRIORITY: [string, string][] = [
  ['bike path', 'paved_separated'],
  ['gravel', 'gravel'],
  ['single track', 'trail'],
  ['road', 'road'],
];

const BEGINNER_TAGS = ['easy', 'family friendly', 'chill'];
const HARD_TAGS = ['single track'];

export function deriveSurface(tags: string[]): string | null {
  const tagSet = new Set(tags.map(t => t.toLowerCase()));
  for (const [tag, surface] of SURFACE_PRIORITY) {
    if (tagSet.has(tag)) return surface;
  }
  return null;
}

export function deriveBeginnerFriendly(tags: string[]): boolean | null {
  const tagSet = new Set(tags.map(t => t.toLowerCase()));
  if (tagSet.has('bike path') && BEGINNER_TAGS.some(t => tagSet.has(t))) return true;
  if (HARD_TAGS.some(t => tagSet.has(t))) return false;
  return null;
}
