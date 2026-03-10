interface OrganizerRef {
  slug: string;
  name: string;
}

interface MatchResult {
  slug: string;
  name: string;
  confidence: number;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function fuzzyMatchOrganizer(
  input: string,
  organizers: OrganizerRef[],
): MatchResult | null {
  if (!input.trim()) return null;

  const normalizedInput = normalize(input);
  if (!normalizedInput) return null;

  let bestMatch: MatchResult | null = null;
  let bestScore = 0;

  for (const org of organizers) {
    const normalizedName = normalize(org.name);
    const normalizedSlug = normalize(org.slug);

    let score = 0;

    // Exact match (case-insensitive)
    if (normalizedInput === normalizedName || normalizedInput === normalizedSlug) {
      score = 1;
    }
    // Input is contained in org name
    else if (normalizedName.includes(normalizedInput)) {
      score = 0.6 + 0.3 * (normalizedInput.length / normalizedName.length);
    }
    // Org name is contained in input
    else if (normalizedInput.includes(normalizedName)) {
      score = 0.6 + 0.3 * (normalizedName.length / normalizedInput.length);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { slug: org.slug, name: org.name, confidence: score };
    }
  }

  return bestScore >= 0.5 ? bestMatch : null;
}
