// src/lib/youtube-extract.ts
// Browser-safe — no node: APIs

export interface YouTubeExtractionResult {
  videoIds: string[];
  cleanedMarkdown: string;
}

// Matches bare YouTube URLs on their own line
const BARE_URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)\S*$/gm;

// Matches markdown links containing YouTube URLs
const MD_LINK_RE = /\[([^\]]*)\]\(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)\S*\)/g;

export function extractYouTubeUrls(markdown: string): YouTubeExtractionResult {
  const videoIds: string[] = [];
  let cleaned = markdown;

  // Extract from markdown links first (more specific pattern)
  cleaned = cleaned.replace(MD_LINK_RE, (_match, _text, id) => {
    videoIds.push(id);
    return '';
  });

  // Extract bare URLs on their own lines
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
