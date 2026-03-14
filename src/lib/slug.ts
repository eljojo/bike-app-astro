export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateSlug(slug: string): string | null {
  if (!slug) return 'Name is required';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return 'Name must start and end with a letter or number, and can only contain letters, numbers, and hyphens';
  }
  return null;
}
