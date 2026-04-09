import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Community Wizard', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('shows fork on /admin/communities/new', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/communities/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Heading asks what the user is adding
    const heading = page.locator('.wizard-welcome-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('What are you adding');

    // Two fork options are visible
    const options = page.locator('.wizard-fork-option');
    await expect(options).toHaveCount(2);
  });

  test('community path: metro stops match community flow', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/communities/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Metro progress is NOT shown on the fork step
    await expect(page.locator('.metro-progress')).not.toBeVisible();

    // Choose community option (first fork button)
    await page.locator('.wizard-fork-option').first().click();

    // Metro progress is now visible
    await expect(page.locator('.metro-progress')).toBeVisible();

    // Community path has exactly 4 stops: Profile, Online, About, Go Live
    const stops = page.locator('.metro-stop');
    await expect(stops).toHaveCount(4);
  });

  test('bike-shop path: metro stops match bike shop flow', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/communities/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Metro progress is NOT shown on the fork step
    await expect(page.locator('.metro-progress')).not.toBeVisible();

    // Choose bike shop option (second fork button)
    await page.locator('.wizard-fork-option').nth(1).click();

    // Metro progress is now visible
    await expect(page.locator('.metro-progress')).toBeVisible();

    // Bike shop path has exactly 5 stops: Profile, Contact, Location, About, Go Live
    const stops = page.locator('.metro-stop');
    await expect(stops).toHaveCount(5);
  });

  test('?full=1 shows CommunityEditor instead of wizard fork', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/communities/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // CommunityEditor is visible
    await expect(page.locator('.community-editor')).toBeVisible();

    // Wizard fork is not present
    await expect(page.locator('.wizard-fork')).not.toBeVisible();
  });

  test('community path: navigate through steps', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/communities/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Step 0: fork — choose community
    await page.locator('.wizard-fork-option').first().click();

    // Step 1: Profile — fill in the name
    await expect(page.locator('.wizard-step-heading')).toContainText('Profile');
    await page.fill('#community-name', 'Test Cycling Club');

    // Continue to step 2: Online
    await page.locator('.wizard-nav button.btn-primary').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Online');

    // Skip Online -> step 3: About
    await page.locator('.wizard-nav-skip').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('About');

    // Skip About -> step 4: Go Live
    await page.locator('.wizard-nav-skip').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Ready to go live?');

    // Save button is present on Go Live step
    const saveBtn = page.locator('.wizard-nav button.btn-primary');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toHaveText('Save');
  });
});
