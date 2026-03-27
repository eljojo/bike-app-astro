// Stub for astro:content — used in vitest to satisfy imports from server modules
// that call getCollection(). Tests that need real collection data should mock this themselves.
export async function getCollection(_name: string) {
  return [];
}
