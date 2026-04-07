import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Event Wizard', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test('shows welcome step on /admin/events/new', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Welcome heading is visible
    const heading = page.locator('.wizard-welcome-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Add an event');

    // "Let's go" button is present
    const letsGo = page.locator('.wizard-welcome button.btn-primary');
    await expect(letsGo).toBeVisible();
    await expect(letsGo).toHaveText("Let's go");
  });

  test('metro progress hidden on welcome, visible with correct stops on step 1', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Metro progress is NOT shown on the welcome step (step 0)
    await expect(page.locator('.metro-progress')).not.toBeVisible();

    // Advance to step 1 by clicking "Let's go"
    await page.locator('.wizard-welcome button.btn-primary').click();

    // Metro progress is now visible
    const metroProgress = page.locator('.metro-progress');
    await expect(metroProgress).toBeVisible();

    // There are exactly 6 stops
    const stops = page.locator('.metro-stop');
    await expect(stops).toHaveCount(6);

    // The current stop (step 1 = STOPS[0] = "Poster") is labelled "Poster"
    const currentStop = page.locator('.metro-stop--current .metro-stop-label');
    await expect(currentStop).toHaveText('Poster');
  });

  test('?full=1 shows EventCreator instead of wizard', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new?full=1');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // EventCreator is visible
    await expect(page.locator('.event-creator')).toBeVisible();

    // Wizard welcome is not present
    await expect(page.locator('.wizard-welcome')).not.toBeVisible();
  });

  test('navigates through all wizard steps via skip', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Step 0 -> Step 1: welcome -> poster
    await page.locator('.wizard-welcome button.btn-primary').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Do you have a poster?');

    // Skip poster -> Step 2: When & Where
    await page.locator('.wizard-nav-skip').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('When and where?');

    // Fill required fields: name and date
    await page.fill('#wizard-event-name', 'Test Event');
    await page.fill('#wizard-start-date', '2099-06-15');

    // Continue to Step 3: Story
    await page.locator('.wizard-nav button.btn-primary').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Tell the story');

    // Skip Story -> Step 4: Details
    await page.locator('.wizard-nav-skip').click();
    await expect(page.locator('.wizard-step-heading')).toContainText('Add more details');

    // Skip Details -> Step 5: Organizer
    await page.locator('.wizard-nav-skip').click();
    await expect(page.locator('.wizard-step-heading')).toContainText("Who's organizing this?");

    // Organizer has no skip — select an existing organizer to continue
    const orgSelect = page.locator('.organizer-select-row select');
    await orgSelect.selectOption({ index: 1 });

    // Continue to Step 6: Review
    await page.locator('.wizard-nav button.btn-primary').click();
    await expect(page.locator('.wizard-step-heading')).toContainText("Here's how it'll look");

    // Save button is present on review step
    const saveBtn = page.locator('.wizard-nav button.btn-primary');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toHaveText('Save');
  });

  test('organizer step shows select and create-new option', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Navigate to Organizer step (step 5): welcome -> skip poster -> fill when & where -> skip story -> skip details
    await page.locator('.wizard-welcome button.btn-primary').click();
    await page.locator('.wizard-nav-skip').click();
    await page.fill('#wizard-event-name', 'Test Event');
    await page.fill('#wizard-start-date', '2099-06-15');
    await page.locator('.wizard-nav button.btn-primary').click();
    await page.locator('.wizard-nav-skip').click();
    await page.locator('.wizard-nav-skip').click();

    // Now on the Organizer step
    await expect(page.locator('.wizard-step-heading')).toContainText("Who's organizing this?");

    // Organizer select dropdown is visible
    const orgSelect = page.locator('.organizer-select-row select');
    await expect(orgSelect).toBeVisible();

    // "or create new" button is visible
    const createNewBtn = page.locator('.organizer-select-row .btn-link');
    await expect(createNewBtn).toBeVisible();
    await expect(createNewBtn).toHaveText('or create new');
  });

  test('rejects past dates in When & Where step', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Navigate to When & Where
    await page.locator('.wizard-welcome button.btn-primary').click();
    await page.locator('.wizard-nav-skip').click();

    // Fill name and a past date
    await page.fill('#wizard-event-name', 'Past Event');
    await page.fill('#wizard-start-date', '2020-01-01');

    // Try to continue
    await page.locator('.wizard-nav button.btn-primary').click();

    // Should show validation error, NOT advance to Story
    await expect(page.locator('.auth-error')).toContainText('past');
    await expect(page.locator('.wizard-step-heading')).toContainText('When and where?');
  });

  test('organizer step requires selection before continuing', async ({ page }) => {
    await loginAs(page, token);

    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    // Navigate to Organizer step
    await page.locator('.wizard-welcome button.btn-primary').click();
    await page.locator('.wizard-nav-skip').click();
    await page.fill('#wizard-event-name', 'Test Event');
    await page.fill('#wizard-start-date', '2099-06-15');
    await page.locator('.wizard-nav button.btn-primary').click();
    await page.locator('.wizard-nav-skip').click();
    await page.locator('.wizard-nav-skip').click();

    // On Organizer step — Continue button should be disabled (no organizer selected)
    const continueBtn = page.locator('.wizard-nav button.btn-primary');
    await expect(continueBtn).toBeDisabled();

    // No skip button should be available
    await expect(page.locator('.wizard-nav-skip')).not.toBeVisible();
  });
});
