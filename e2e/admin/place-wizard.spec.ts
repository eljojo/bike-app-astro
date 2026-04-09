import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Place Wizard', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('shows welcome step on /admin/places/new', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/places/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Welcome heading is visible and contains "Add a place"
    const heading = page.locator('.wizard-welcome-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Add a place');

    // "Let's go" button is present
    const letsGo = page.locator('.wizard-welcome-begin button.btn-primary');
    await expect(letsGo).toBeVisible();
    await expect(letsGo).toHaveText("Let's go");
  });

  test('metro progress shows correct stops on step 1', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/places/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Metro progress is NOT shown on the welcome step (step 0)
    await expect(page.locator('.metro-progress')).not.toBeVisible();

    // Advance to step 1 by clicking "Let's go"
    await page.locator('.wizard-welcome-begin button.btn-primary').click();

    // Metro progress is now visible
    const metroProgress = page.locator('.metro-progress');
    await expect(metroProgress).toBeVisible();

    // There are exactly 4 stops (Find, Describe, Photo, Go Live)
    const stops = page.locator('.metro-stop');
    await expect(stops).toHaveCount(4);
  });

  test('?full=1 shows PlaceEditor instead of wizard', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/places/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // PlaceEditor is visible
    await expect(page.locator('.place-editor')).toBeVisible();

    // Wizard welcome is not present
    await expect(page.locator('.wizard-welcome')).not.toBeVisible();
  });

  test('navigates to find step and map toggle works', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/places/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Advance from welcome to Find step (step 1)
    await page.locator('.wizard-welcome-begin button.btn-primary').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Find it');

    // "Place a pin manually" button is visible before map is shown
    const pinButton = page.locator('button.btn-secondary', { hasText: 'Place a pin manually' });
    await expect(pinButton).toBeVisible();

    // Map container is not yet visible
    await expect(page.locator('.place-map-picker')).not.toBeVisible();

    // Click "Place a pin manually" — map container should appear
    await pinButton.click();
    await expect(page.locator('.place-map-picker')).toBeVisible();
  });
});
