/** Strip markdown formatting from a body and return the first two non-empty lines as preview text. */
export function makePreview(body?: string): string[] {
  if (!body) return [];
  const stripped = body
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // [text](url) → text
    .replace(/https?:\/\/\S+/g, '')            // bare URLs
    .replace(/[#*_]/g, '');                     // remaining markdown
  return stripped.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, 2);
}
