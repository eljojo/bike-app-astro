import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, clearContentEdits, restoreFixtureFiles, waitForHydration } from './helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Admin Save Flow', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedSession();

    // Generate test photo fixture
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });
    const testPhotoPath = path.join(fixturesDir, 'test-photo.jpg');
    if (!fs.existsSync(testPhotoPath)) {
      const img = await sharp({
        create: { width: 100, height: 75, channels: 3, background: { r: 128, g: 200, b: 100 } },
      })
        .jpeg()
        .toBuffer();
      fs.writeFileSync(testPhotoPath, img);
    }
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    clearContentEdits('routes', 'route-save');
    // Restore modified fixture files so retries see original state
    restoreFixtureFiles([
      'demo/routes/route-save/index.md',
      'demo/routes/route-save/media.yml',
    ]);
  });

  test('upload photo, edit tagline, save, verify commit and persistence', async ({ page }) => {
    await loginAs(page, token);

    // Navigate to route editor
    await page.goto('/admin/routes/route-save');
    await page.waitForLoadState('networkidle');

    await waitForHydration(page);

    // Record initial state
    const photoCards = page.locator('.photo-card');
    const initialPhotoCount = await photoCards.count();
    const taglineInput = page.locator('#route-tagline');

    // --- Upload a photo ---
    const fileInput = page.locator('input[type="file"][accept*="image"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/test-photo.jpg'));

    // Wait for photo to appear in grid (more reliable than checking "Uploading" text)
    await expect(photoCards).toHaveCount(initialPhotoCount + 1, { timeout: 15000 });
    const afterUploadCount = initialPhotoCount + 1;

    // The new photo should have a visible image
    const newPhoto = photoCards.last();
    await expect(newPhoto.locator('img')).toBeVisible();

    // --- Edit the tagline ---
    const testTagline = `E2E test tagline ${Date.now()}`;
    await taglineInput.fill(testTagline);

    // Record the git HEAD before save
    const headBefore = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();

    // --- Save ---
    const saveButton = page.locator('button.btn-primary', { hasText: 'Save' });
    await saveButton.click();

    // Verify success toast appears
    await expect(page.locator('.save-success')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.save-success')).toContainText('Saved');

    // --- Verify git commit in fixture repo ---
    const headAfter = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify tagline was written to index.md
    const indexMd = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/routes/route-save/index.md'),
      'utf-8'
    );
    expect(indexMd).toContain(testTagline);

    // Verify frontmatter preserves fields the admin doesn't edit
    const { data: savedFrontmatter } = matter(indexMd);
    // Admin-editable fields should be present
    expect(savedFrontmatter.name).toBe('Save Test Route');
    expect(typeof savedFrontmatter.distance_km).toBe('number');
    expect(savedFrontmatter.status).toBe('published');
    expect(savedFrontmatter.tags).toContain('road');
    // Non-admin fields must survive the save
    expect(savedFrontmatter.created_at).toBe('2022-11-19');
    expect(savedFrontmatter.updated_at).toBe('2023-06-26');
    expect(savedFrontmatter.variants).toHaveLength(2);
    expect(savedFrontmatter.variants[0].strava_url).toBe('https://www.strava.com/activities/11458503483');
    expect(savedFrontmatter.variants[1].gpx).toBe('variants/main.gpx');
    // 'distance' (admin key) should NOT appear — only 'distance_km' (content key)
    expect(savedFrontmatter).not.toHaveProperty('distance');

    // Verify media.yml contains the uploaded photo
    const mediaYaml = fs.readFileSync(
      path.join(FIXTURE_DIR, 'demo/routes/route-save/media.yml'),
      'utf-8'
    );
    const mediaEntries = yaml.load(mediaYaml) as Array<{ key: string; type?: string }>;
    const photoEntries = mediaEntries.filter((m) => m.type === 'photo');
    expect(photoEntries.length).toBeGreaterThan(initialPhotoCount);

    // --- Reload and verify persistence ---
    await page.reload();
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Tagline should persist (from D1 scratchpad cache)
    await expect(taglineInput).toHaveValue(testTagline);

    // Photos should still be visible
    const reloadPhotoCount = await page.locator('.photo-card').count();
    expect(reloadPhotoCount).toBe(afterUploadCount);
  });
});
