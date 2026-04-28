/**
 * E2E test for the community cover photo flow:
 * upload via the cover slot → save → verify cover-flagged media item written to file.
 *
 * NOTE: The public community detail page is prerendered (static). It reflects
 * fixture state at build time, not live saves. Hero and OG tag checks are
 * done via the written markdown file rather than the public page.
 *
 * NOTE: The admin detail JSON endpoint is also prerendered. To seed pre-existing
 * cover state into the editor, we use seedContentEdit() to write into the D1
 * content_edits cache (Tier 1 of loadDetailFromJson). The editor reads Tier 1
 * first, so the seeded JSON is what the editor initializes with.
 *
 * NOTE: D1 conflict detection compares the cached github_sha to the current
 * file's blob SHA (computed as git hash-object). When seeding D1 for a test,
 * we must pass a github_sha that matches the actual file blob SHA, otherwise
 * the save handler returns 409. We compute the blob SHA from the modified file
 * before seeding.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { computeBlobSha } from '../../src/lib/git/git-utils';
import { FIXTURE_DIR } from './fixture-setup.ts';
import {
  seedSession, cleanupSession, loginAs,
  clearContentEdits, seedContentEdit, restoreFixtureFiles,
  waitForHydration,
} from './helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_PATH = 'demo/organizers/community-cover-test.md';
const SLUG = 'community-cover-test';

// Minimal OrganizerDetail JSON matching the community-cover-test fixture.
// Used as the base for D1 cache seeds. Must pass organizerDetailFromCache Zod validation.
const BASE_DETAIL = {
  slug: SLUG,
  name: 'Community Cover Test Org',
  tagline: 'Fixture for cover-photo e2e tests',
  tags: ['test'],
  featured: false,
  hidden: false,
  website: 'https://community-cover-test.example.com',
  social_links: [],
  media: [],
  body: 'A bio for testing community cover photo flows.',
};

test.describe('Community Cover Photo', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.beforeEach(() => {
    restoreFixtureFiles([FIXTURE_PATH]);
    clearContentEdits('organizers', SLUG);
  });

  test.afterAll(() => {
    cleanupSession(token);
    restoreFixtureFiles([FIXTURE_PATH]);
  });

  test('upload cover, save, verify file has cover-flagged media item', async ({ page }) => {
    await loginAs(page, token);
    await page.goto(`/admin/communities/${SLUG}`);
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // The cover upload state: hidden input inside the upload drop zone.
    // setInputFiles works on hidden inputs.
    const coverInput = page.locator('.cover-photo-field input[type="file"]');
    await coverInput.setInputFiles(path.resolve(__dirname, 'fixtures/test-photo.jpg'));

    // Wait for upload to finish — preview image appears replacing the upload zone.
    await expect(page.locator('.cover-photo-field-preview img')).toBeVisible({ timeout: 15000 });

    // Save.
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.save-success')).toContainText('Saved');

    // Verify the markdown file has a cover-flagged media item.
    const filePath = path.join(FIXTURE_DIR, FIXTURE_PATH);
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data } = matter(raw);
    const media = data.media as Array<{ key: string; cover?: boolean }>;
    expect(Array.isArray(media)).toBe(true);
    const covers = media.filter(m => m.cover === true);
    expect(covers).toHaveLength(1);
    expect(covers[0].key).toBeTruthy();
  });

  test('removing the cover un-flags the media and removes the cover item', async ({ page }) => {
    const seedCoverKey = 'organizers/community-cover-test/seed-cover.jpg';

    // Write the cover into the fixture file — this is what the save handler reads.
    const filePath = path.join(FIXTURE_DIR, FIXTURE_PATH);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    parsed.data.media = [{ key: seedCoverKey, type: 'photo', cover: true }];
    const updatedContent = matter.stringify(parsed.content, parsed.data);
    fs.writeFileSync(filePath, updatedContent);

    // Seed D1 so the editor initialises with the cover (Tier 1 of loadDetailFromJson).
    // The github_sha must match the file blob SHA to avoid a 409 conflict on save.
    const blobSha = computeBlobSha(updatedContent);
    const seedDetail = {
      ...BASE_DETAIL,
      media: [{ key: seedCoverKey, type: 'photo', cover: true }],
    };
    seedContentEdit('organizers', SLUG, JSON.stringify(seedDetail), blobSha);

    await loginAs(page, token);
    await page.goto(`/admin/communities/${SLUG}`);
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Cover slot shows the seeded preview (cover loaded from D1 cache).
    await expect(page.locator('.cover-photo-field-preview img')).toBeVisible();

    // Click Remove.
    await page.locator('.cover-photo-field .btn-remove-photo').click();

    // After removal the upload zone reappears.
    await expect(page.locator('.cover-photo-field-upload')).toBeVisible();

    // Save.
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.save-success')).toContainText('Saved');

    // File no longer has any cover-flagged media.
    const after = matter(fs.readFileSync(filePath, 'utf8'));
    const media = (after.data.media ?? []) as Array<{ cover?: boolean }>;
    expect(media.filter(m => m.cover === true)).toHaveLength(0);
  });

  test('non-cover media items pass through unchanged when only the cover is replaced', async ({ page }) => {
    const oldCoverKey = 'organizers/community-cover-test/old-cover.jpg';
    const legacyKey = 'organizers/community-cover-test/legacy-gallery.jpg';

    // Write the seeded state into the fixture file.
    const filePath = path.join(FIXTURE_DIR, FIXTURE_PATH);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    parsed.data.media = [
      { key: oldCoverKey, type: 'photo', cover: true },
      { key: legacyKey, type: 'photo', caption: 'Legacy photo' },
    ];
    const updatedContent = matter.stringify(parsed.content, parsed.data);
    fs.writeFileSync(filePath, updatedContent);

    // Seed D1 so the editor loads the seeded state (cover + legacy gallery).
    const blobSha = computeBlobSha(updatedContent);
    const seedDetail = {
      ...BASE_DETAIL,
      media: [
        { key: oldCoverKey, type: 'photo', cover: true },
        { key: legacyKey, type: 'photo', caption: 'Legacy photo' },
      ],
    };
    seedContentEdit('organizers', SLUG, JSON.stringify(seedDetail), blobSha);

    await loginAs(page, token);
    await page.goto(`/admin/communities/${SLUG}`);
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Replace the cover by uploading a different file via the cover slot.
    // In preview state the input is inside .cover-photo-field-preview (hidden via ref).
    const coverInput = page.locator('.cover-photo-field input[type="file"]');
    await coverInput.setInputFiles(path.resolve(__dirname, 'fixtures/test-photo.jpg'));
    await expect(page.locator('.cover-photo-field-preview img')).toBeVisible({ timeout: 15000 });

    // Save.
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.save-success')).toContainText('Saved');

    // The non-cover legacy item must still be present on disk.
    const after = matter(fs.readFileSync(filePath, 'utf8'));
    const media = (after.data.media ?? []) as Array<{ key: string; cover?: boolean }>;
    const legacy = media.find(m => m.key === legacyKey);
    expect(legacy).toBeDefined();
    expect(legacy?.cover).toBeFalsy();

    // Exactly one cover-flagged item remains.
    expect(media.filter(m => m.cover === true)).toHaveLength(1);
  });
});
