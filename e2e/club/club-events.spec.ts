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
  test('renders event header and facts card', async ({ page }) => {
    await page.goto('/events/2024/brm-300-vuelta-rocas');
    await page.waitForLoadState('networkidle');

    // Event name
    await expect(page.locator('h1')).toHaveText('BRM 300 Vuelta Rocas');

    // Facts card shows all hard facts
    const facts = page.locator('.event-detail-facts');
    await expect(facts).toBeVisible();
    await expect(facts).toContainText('300 km');
    await expect(facts).toContainText('20');
    await expect(facts).toContainText('Plaza Italia, Santiago');
    await expect(facts).toContainText('$15.000 CLP');
    await expect(facts).toContainText('80');

    // Organizer card
    const organizer = page.locator('.event-organizer');
    await expect(organizer).toContainText('Randonneurs Chile');

    // Departure groups
    await expect(facts.locator('.event-detail-departure-groups li')).toHaveCount(2);

    // Past event uses tag-derived noun (brevet → "recorrido" in es-CL)
    const pastState = page.locator('.event-detail-past-state');
    await expect(pastState).toContainText('recorrido');
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
    await resultsDetails.locator('> summary').click();

    const results = resultsDetails.locator('.results-section');
    await expect(results).toBeVisible();

    // Results summary shows finisher count
    await expect(results.locator('.results-summary')).toContainText('3');

    // Finishers table only (direct child, excludes non-finishers nested table)
    const rows = results.locator('> .event-results-table tbody tr');
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
  test('renders upcoming event with facts and registration', async ({ page }) => {
    await page.goto('/events/2099/brm-200-ruta-del-vino');
    await page.waitForLoadState('networkidle');

    // Event name
    await expect(page.locator('h1')).toHaveText('BRM 200 Ruta del Vino');

    // Facts card with all details
    const facts = page.locator('.event-detail-facts');
    await expect(facts).toBeVisible();
    await expect(facts).toContainText('200 km');
    await expect(facts).toContainText('13.5');
    await expect(facts).toContainText('Estación Mapocho, Santiago');
    await expect(facts).toContainText('$12.000 CLP');
    await expect(facts).toContainText('100');
    await expect(facts).toContainText('2099-04-15');

    // Registration CTA links to registration URL
    const regLink = facts.locator('.event-detail-facts-cta');
    await expect(regLink).toBeVisible();
    await expect(regLink).toHaveAttribute('href', 'https://example.com/register-200');

    // Organizer card
    const organizer = page.locator('.event-organizer');
    await expect(organizer).toContainText('Randonneurs Chile');
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
