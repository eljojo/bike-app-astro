import { test, expect } from '@playwright/test';
import { seedSession, cleanupSession, loginAs, waitForHydration } from './helpers.ts';

test.describe('Tag Autocomplete', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/routes/carp');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);
  });

  test('datalist contains unselected known tags', async ({ page }) => {
    const options = page.locator('#tag-suggestions option');
    const values = await options.evaluateAll(els =>
      els.map(el => (el as HTMLOptionElement).value)
    );

    // "road" is already on the carp route — should be excluded
    expect(values).not.toContain('road');

    // "scenic" and "bike path" from the canal route should be present
    expect(values).toContain('scenic');
    expect(values).toContain('bike path');
  });

  test('datalist includes translations for search', async ({ page }) => {
    const options = page.locator('#tag-suggestions option');
    const values = await options.evaluateAll(els =>
      els.map(el => (el as HTMLOptionElement).value)
    );

    // French translations should be in the datalist for cross-language search
    expect(values).toContain('panoramique');
    expect(values).toContain('piste cyclable');

    // "route" (French for "road") should NOT be present since "road" is already selected
    expect(values).not.toContain('route');
  });

  test('selecting a known tag adds it', async ({ page }) => {
    const tagInput = page.locator('.tag-input');
    await tagInput.fill('scenic');
    await tagInput.press('Enter');

    // Tag pill should appear with the English key
    const pills = page.locator('.tag-pill');
    const pillTexts = await pills.allTextContents();
    expect(pillTexts.some(t => t.includes('scenic'))).toBe(true);
  });

  test('typing a translation resolves to the primary key', async ({ page }) => {
    const tagInput = page.locator('.tag-input');
    await tagInput.fill('panoramique');
    await tagInput.press('Enter');

    // Should resolve "panoramique" → "scenic"
    const pills = page.locator('.tag-pill');
    const pillTexts = await pills.allTextContents();
    expect(pillTexts.some(t => t.includes('scenic'))).toBe(true);
  });

  test('free-form tags can still be added', async ({ page }) => {
    const tagInput = page.locator('.tag-input');
    await tagInput.fill('winter');
    await tagInput.press('Enter');

    const pills = page.locator('.tag-pill');
    const pillTexts = await pills.allTextContents();
    expect(pillTexts.some(t => t.includes('winter'))).toBe(true);
  });

  test('added tag is removed from datalist suggestions', async ({ page }) => {
    const tagInput = page.locator('.tag-input');

    // Add "scenic"
    await tagInput.fill('scenic');
    await tagInput.press('Enter');

    // Now "scenic" and its translation should no longer appear in datalist
    const options = page.locator('#tag-suggestions option');
    const values = await options.evaluateAll(els =>
      els.map(el => (el as HTMLOptionElement).value)
    );

    expect(values).not.toContain('scenic');
    expect(values).not.toContain('panoramique');
  });
});
