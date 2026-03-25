// src/lib/youtube-extract.ts
// Browser-safe — no node: APIs

export interface YouTubeExtractionResult {
  videoIds: string[];
  cleanedMarkdown: string;
}

// Matches bare YouTube URLs on their own line — not inside markdown links.
// Inline markdown links like [text](https://youtube.com/...) are intentional
// editorial hyperlinks, not embed requests. Only bare URLs signal "embed this."
const BARE_URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)\S*$/gm;

export function extractYouTubeUrls(markdown: string): YouTubeExtractionResult {
  const videoIds: string[] = [];
  let cleaned = markdown;

  cleaned = cleaned.replace(BARE_URL_RE, (_match, id) => {
    if (!videoIds.includes(id)) {
      videoIds.push(id);
    }
    return '';
  });

  // Collapse triple+ newlines to double
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { videoIds, cleanedMarkdown: cleaned };
}
