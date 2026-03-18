import { test, expect } from '@playwright/test';

test.describe('Club homepage', () => {
  test('shows club tagline and upcoming events', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Club tagline is displayed
    await expect(page.locator('.welcome-message h3')).toContainText('A demo randonneuring club');

    // Upcoming events section exists
    await expect(page.locator('.club-home')).toBeVisible();

    // Upcoming + recent past event cards visible
    await expect(page.locator('.event-card')).toHaveCount(2);
    await expect(page.locator('.event-card').first()).toContainText('BRM 200 Ruta del Vino');
  });
});

test.describe('Club events list', () => {
  test('shows upcoming and past events grouped by year', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');

    // Title (es-CL locale)
    await expect(page.locator('h1')).toContainText('Eventos');

    // Upcoming event card links to detail page
    const upcomingCard = page.locator('.events-grid .event-card').first();
    await expect(upcomingCard).toContainText('BRM 200 Ruta del Vino');
    const link = upcomingCard.locator('a.event-name');
    await expect(link).toHaveAttribute('href', /\/events\/2099\//);

    // Past events visible with year headings (no toggle)
    await expect(page.locator('h2')).toContainText('2024');
    await expect(page.locator('.event-card')).toHaveCount(2);
  });
});

test.describe('Club event detail — past event with results', () => {
  test('renders event header', async ({ page }) => {
    await page.goto('/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');

    // Event name
    await expect(page.locator('h1')).toHaveText('BRM 300 Vuelta Rocas');

    // Essential line shows date, distance, and organizer
    const essential = page.locator('.event-detail-essential');
    await expect(essential).toBeVisible();
    await expect(essential).toContainText('300 km');
    await expect(essential).toContainText('Randonneurs Chile');
  });

  test('renders essential line with event details', async ({ page }) => {
    await page.goto('/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');

    const essential = page.locator('.event-detail-essential');
    await expect(essential).toBeVisible();

    // Time limit
    await expect(essential).toContainText('20h');
  });

  test('renders waypoint timeline inside collapsible', async ({ page }) => {
    await page.goto('/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');

    // Waypoints are inside a collapsible <details> — open it
    const waypointsDetails = page.locator('.event-detail-collapsible').first();
    await expect(waypointsDetails).toBeVisible();
    await waypointsDetails.locator('summary').click();

    const timeline = page.locator('.waypoint-timeline');
    await expect(timeline).toBeVisible();

    // Two waypoints
    await expect(timeline.locator('.waypoint-timeline-item')).toHaveCount(2);

    // First checkpoint
    await expect(timeline.locator('.waypoint-timeline-item').first()).toContainText('CP1 Pomaire');
    await expect(timeline.locator('.waypoint-timeline-item').first()).toContainText('85');
    await expect(timeline.locator('.waypoint-timeline-item').first()).toContainText('Fill bottles here');

    // Second checkpoint
    await expect(timeline.locator('.waypoint-timeline-item').nth(1)).toContainText('CP2 Rapel');
  });

  test('renders results table with finishers and non-finishers', async ({ page }) => {
    await page.goto('/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');

    // Results are inside a collapsible <details> — open it
    const resultsDetails = page.locator('.event-detail-collapsible').nth(1);
    await expect(resultsDetails).toBeVisible();
    await resultsDetails.locator('summary').click();

    const results = resultsDetails.locator('.results-section');
    await expect(results).toBeVisible();

    // Results summary shows finisher count
    await expect(results.locator('.results-summary')).toContainText('3');

    // Finishers table (exclude non-finishers section)
    const rows = results.locator('.event-results-table tbody tr');
    await expect(rows).toHaveCount(3);

    // Check first finisher
    await expect(rows.first()).toContainText('García');
    await expect(rows.first()).toContainText('14h32m');
    await expect(rows.first()).toContainText('ACP-2024-001');

    // Non-finishers section
    const nonFinishers = results.locator('.non-finishers');
    await expect(nonFinishers).toBeVisible();
    await expect(nonFinishers).toContainText('2 non-finishers');
  });

  test('renders route map', async ({ page }) => {
    await page.goto('/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');

    // Route map section exists
    const mapSection = page.locator('.event-route-map-container');
    await expect(mapSection).toBeVisible();
  });
});

test.describe('Club event detail — upcoming event', () => {
  test('renders upcoming event with registration link', async ({ page }) => {
    await page.goto('/events/2099/brm-200-ruta-del-vino');
    await page.waitForLoadState('networkidle');

    // Event name
    await expect(page.locator('h1')).toHaveText('BRM 200 Ruta del Vino');

    // Registration link in quiet registration section
    const regSection = page.locator('.event-detail-registration');
    await expect(regSection).toBeVisible();
    const regLink = regSection.locator('a');
    await expect(regLink).toHaveAttribute('href', 'https://example.com/register-200');

    // Essential line shows time limit
    const essential = page.locator('.event-detail-essential');
    await expect(essential).toContainText('13.5h');
  });

  test('renders waypoint for upcoming event', async ({ page }) => {
    await page.goto('/events/2099/brm-200-ruta-del-vino');
    await page.waitForLoadState('networkidle');

    // Waypoints are inside a collapsible <details> — open it
    const waypointsDetails = page.locator('.event-detail-collapsible').first();
    await expect(waypointsDetails).toBeVisible();
    await waypointsDetails.locator('summary').click();

    const timeline = page.locator('.waypoint-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.waypoint-timeline-item')).toHaveCount(1);
    await expect(timeline).toContainText('CP1 Pomaire');
  });
});

test.describe('Navigation', () => {
  test('back link from event detail returns to events list', async ({ page }) => {
    await page.goto('/events/2099/brm-200-ruta-del-vino');
    await page.waitForLoadState('networkidle');

    const backLink = page.locator('.go-back-button');
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/events');
  });
});
