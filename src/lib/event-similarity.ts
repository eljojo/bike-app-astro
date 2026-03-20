export interface EventSimilarityInput {
  id: string;
  organizer: string;
  tags: string[];
  distances: string;
  linkedRoutes: string[];
  startDate: string; // YYYY-MM-DD
}

export function scorePair(a: EventSimilarityInput, b: EventSimilarityInput): number {
  let score = 0;

  if (a.organizer && b.organizer && a.organizer === b.organizer) {
    score += 50;
  }

  const bTags = new Set(b.tags);
  let tagMatches = 0;
  for (const tag of a.tags) {
    if (bTags.has(tag) && tagMatches < 3) {
      score += 15;
      tagMatches++;
    }
  }

  if (a.linkedRoutes.length > 0 && b.linkedRoutes.length > 0) {
    const bRoutes = new Set(b.linkedRoutes);
    if (a.linkedRoutes.some(r => bRoutes.has(r))) {
      score += 20;
    }
  }

  const aDist = parseMaxDistance(a.distances);
  const bDist = parseMaxDistance(b.distances);
  if (aDist > 0 && bDist > 0) {
    const ratio = Math.min(aDist, bDist) / Math.max(aDist, bDist);
    if (ratio >= 0.8) score += 10;
  }

  return score;
}

function parseMaxDistance(distances: string): number {
  if (!distances) return 0;
  const nums = distances.match(/\d+/g);
  if (!nums) return 0;
  return Math.max(...nums.map(Number));
}

export function findSimilarEvents(
  eventId: string,
  events: EventSimilarityInput[],
  editionIds: Set<string>,
  limit = 3,
  minScore = 20,
): { id: string; score: number }[] {
  const self = events.find(e => e.id === eventId);
  if (!self) return [];

  const today = new Date().toISOString().slice(0, 10);

  const scores: { id: string; score: number }[] = [];
  for (const other of events) {
    if (other.id === eventId) continue;
    if (editionIds.has(other.id)) continue;
    let score = scorePair(self, other);
    // Boost upcoming/current-year events so they appear before past ones
    if (other.startDate >= today) score += 30;
    if (score >= minScore) {
      scores.push({ id: other.id, score });
    }
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, limit);
}
