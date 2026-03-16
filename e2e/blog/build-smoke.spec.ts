/**
 * Smoke test: verify the blog build produced prerendered pages.
 *
 * Astro can silently skip prerendering (exit 0, zero HTML files) when
 * middleware imports break the prerender step. This test catches that
 * by checking key pages return 200 — a failure here means the build
 * is broken, not that individual page content is wrong.
 */
import { test, expect } from '@playwright/test';

const pages = [
  '/',
  '/rides',
  '/tours',
  '/stats',
  '/about',
  '/rides/2026-01-23-winter-ride',
];

for (const path of pages) {
  test(`${path} returns 200`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status(), `${path} returned ${response.status()}`).toBe(200);
  });
}
