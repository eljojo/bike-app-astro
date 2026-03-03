import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import yaml from 'js-yaml';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '.data', 'local.db');
const FIXTURE_DIR = path.resolve(__dirname, '..', '.data', 'e2e-content');

function seedTestSession(): string {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  const userId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT OR REPLACE INTO users (id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'playwright@test.local', 'Playwright Test', 'admin', now);

  db.prepare(
    'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, token, expiresAt, now);

  // Clear stale route edits from previous runs so conflict detection doesn't fire
  try {
    db.prepare('DELETE FROM route_edits').run();
  } catch {
    // Table may not exist yet on first run
  }

  db.close();
  return token;
}

function cleanupTestSession(token: string) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  db.prepare("DELETE FROM users WHERE email = 'playwright@test.local'").run();
  db.close();
}

test.describe('Admin Save Flow', () => {
  let token: string;

  test.beforeAll(async () => {
    token = seedTestSession();

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
    cleanupTestSession(token);
  });

  test('upload photo, edit tagline, save, verify commit and persistence', async ({ page }) => {
    // Authenticate
    await page.context().addCookies([
      {
        name: 'session_token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ]);

    // Navigate to route editor
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');

    // Wait for Preact hydration
    await page.waitForTimeout(2000);

    // Record initial state
    const photoCards = page.locator('.photo-card');
    const initialPhotoCount = await photoCards.count();
    const taglineInput = page.locator('#route-tagline');
    const originalTagline = await taglineInput.inputValue();

    // --- Upload a photo ---
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/test-photo.jpg'));

    // Wait for upload to complete
    await expect(page.locator('.drop-zone')).not.toContainText('Uploading', { timeout: 10000 });

    // Verify photo appeared in grid
    const afterUploadCount = await photoCards.count();
    expect(afterUploadCount).toBe(initialPhotoCount + 1);

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
      path.join(FIXTURE_DIR, 'ottawa/routes/carp/index.md'),
      'utf-8'
    );
    expect(indexMd).toContain(testTagline);

    // Verify frontmatter preserves fields the admin doesn't edit
    const { data: savedFrontmatter } = matter(indexMd);
    // Admin-editable fields should be present
    expect(savedFrontmatter.name).toBe('Towards Carp');
    expect(savedFrontmatter.distance_km).toBe(67.7);
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
      path.join(FIXTURE_DIR, 'ottawa/routes/carp/media.yml'),
      'utf-8'
    );
    const mediaEntries = yaml.load(mediaYaml) as Array<{ key: string; type?: string }>;
    const photoEntries = mediaEntries.filter((m) => m.type === 'photo');
    expect(photoEntries.length).toBeGreaterThan(initialPhotoCount);

    // --- Reload and verify persistence ---
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Tagline should persist (from D1 scratchpad cache)
    await expect(taglineInput).toHaveValue(testTagline);

    // Photos should still be visible
    const reloadPhotoCount = await page.locator('.photo-card').count();
    expect(reloadPhotoCount).toBe(afterUploadCount);
  });
});
