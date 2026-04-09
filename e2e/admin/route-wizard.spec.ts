import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GPX_FIXTURE = path.join(__dirname, 'fixtures', 'test-route.gpx');

test.describe('Route Wizard', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('shows welcome step on /admin/routes/new', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Welcome heading is visible
    const heading = page.locator('.wizard-welcome-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Share a route you love');

    // "Let's go" button is present
    const letsGo = page.locator('.wizard-welcome button.btn-primary');
    await expect(letsGo).toBeVisible();
    await expect(letsGo).toHaveText("Let's go");
  });

  test('metro progress hidden on welcome, visible with correct stops on step 1', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Metro progress is NOT shown on the welcome step (step 0)
    await expect(page.locator('.metro-progress')).not.toBeVisible();

    // Advance to step 1 by clicking "Let's go"
    await page.locator('.wizard-welcome button.btn-primary').click();

    // Metro progress is now visible
    const metroProgress = page.locator('.metro-progress');
    await expect(metroProgress).toBeVisible();

    // There are exactly 4 stops
    const stops = page.locator('.metro-stop');
    await expect(stops).toHaveCount(4);

    // The current stop (step 1 = STOPS[0] = "Route") is labelled "Route"
    const currentStop = page.locator('.metro-stop--current .metro-stop-label');
    await expect(currentStop).toHaveText('Route');
  });

  test('?full=1 shows RouteCreator instead of wizard', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // RouteCreator prompt is visible
    await expect(page.locator('.route-creator-prompt')).toBeVisible();

    // Wizard welcome is not present
    await expect(page.locator('.wizard-welcome')).not.toBeVisible();
  });

  test('GPX upload advances to naming step with map', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Advance past welcome
    await page.locator('.wizard-welcome button.btn-primary').click();

    // Upload the GPX fixture
    const gpxInput = page.locator('input[type="file"][accept=".gpx"]');
    await gpxInput.setInputFiles(GPX_FIXTURE);

    // "Name your route" heading should appear
    const stepHeading = page.locator('.wizard-step-heading');
    await expect(stepHeading).toContainText('Name your route', { timeout: 5000 });

    // Route preview map should be visible
    const previewMap = page.locator('.route-preview-map');
    await expect(previewMap).toBeVisible({ timeout: 10000 });
  });

  test('navigates through all wizard steps via skip buttons', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/routes/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Step 0 → Step 1: welcome → route upload
    await page.locator('.wizard-welcome button.btn-primary').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Where does it go?');

    // Upload GPX to advance within step 1
    const gpxInput = page.locator('input[type="file"][accept=".gpx"]');
    await gpxInput.setInputFiles(GPX_FIXTURE);
    await expect(page.locator('.wizard-step-heading')).toContainText('Name your route', { timeout: 5000 });

    // Step 1 → Step 2: continue with the auto-populated name
    const continueBtn = page.locator('.wizard-nav button.btn-primary');
    await expect(continueBtn).toBeVisible();
    await continueBtn.click();

    // Step 2 (Story): "What makes this ride worth doing?"
    await expect(page.locator('.wizard-step-heading')).toContainText('What makes this ride worth doing?');

    // Skip Story → Step 3 (Photos)
    await page.locator('.wizard-nav-skip').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Show people what it\'s like');

    // Skip Photos → Step 4 (Review)
    await page.locator('.wizard-nav-skip').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Here\'s how it\'ll look');

    // Save button is present on review step
    const saveBtn = page.locator('.wizard-nav button.btn-primary');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toHaveText('Save');
  });
});
