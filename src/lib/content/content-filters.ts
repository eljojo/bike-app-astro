export function isPublished(item: { data: { status: string } }): boolean {
  return item.data.status === 'published';
}
