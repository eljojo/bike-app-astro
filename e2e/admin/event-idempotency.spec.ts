/**
 * E2E test for the duplicate-create rejection.
 *
 * Two POSTs to /api/events/new carrying the same form_instance_id must
 * result in: the first creates an event (200), the second is REJECTED
 * with 409. No -2 suffix, no silent merge, no replay. The client is
 * responsible for not sending the second; this test exercises the
 * server-side safety net.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_DIR } from './fixture-setup.ts';
import { seedSession, cleanupSession, loginAs, cleanupCreatedFiles, clearContentEdits } from './helpers.ts';

const TEST_YEAR = '2099';
const TEST_SLUG = 'idem-test-event';
const TEST_EVENT_ID = `${TEST_YEAR}/${TEST_SLUG}`;

function eventPayload(formInstanceId: string) {
  return {
    frontmatter: {
      name: 'Form Submission Test Event',
      start_date: `${TEST_YEAR}-06-15`,
    },
    body: 'Test body asserting duplicate-create rejection.',
    slug: TEST_SLUG,
    form_instance_id: formInstanceId,
  };
}

async function saveEvent(
  page: import('@playwright/test').Page,
  payload: ReturnType<typeof eventPayload>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async (p) => {
    const res = await fetch('/api/events/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    return { status: res.status, body: await res.json() };
  }, payload);
}

test.describe('Event Save — form_instance_id rejection', () => {
  let token: string;

  test.beforeAll(() => {
    token = seedSession();
  });

  test.afterAll(() => {
    cleanupSession(token);
  });

  test.beforeEach(() => {
    cleanupCreatedFiles([
      `demo/events/${TEST_YEAR}/${TEST_SLUG}.md`,
      `demo/events/${TEST_YEAR}/${TEST_SLUG}`,
      `demo/events/${TEST_YEAR}/${TEST_SLUG}-2.md`,
      `demo/events/${TEST_YEAR}/${TEST_SLUG}-2`,
    ]);
    clearContentEdits('events', TEST_EVENT_ID);
    clearContentEdits('events', `${TEST_EVENT_ID}-2`);
  });

  test('first POST creates the event; second POST with same form_instance_id is rejected with 409', async ({ page }) => {
    await loginAs(page, token);
    await page.goto('/admin/events/new');
    await page.waitForLoadState('networkidle');

    const formInstanceId = `e2e-form-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = eventPayload(formInstanceId);

    // First save — creates the event.
    const res1 = await saveEvent(page, payload);
    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.id).toBe(TEST_EVENT_ID);

    // Second save with the SAME form_instance_id — server must reject.
    // Without server-side rejection, checkExistence allocates -2, returning 200 with a different id.
    const res2 = await saveEvent(page, payload);
    expect(res2.status).toBe(409);

    // Only the canonical event file may exist; no -2 sibling.
    const flatPath = path.join(FIXTURE_DIR, 'demo/events', TEST_YEAR, `${TEST_SLUG}.md`);
    const dirPath = path.join(FIXTURE_DIR, 'demo/events', TEST_YEAR, TEST_SLUG, 'index.md');
    expect(fs.existsSync(flatPath) || fs.existsSync(dirPath)).toBe(true);

    const dupFlatPath = path.join(FIXTURE_DIR, 'demo/events', TEST_YEAR, `${TEST_SLUG}-2.md`);
    const dupDirPath = path.join(FIXTURE_DIR, 'demo/events', TEST_YEAR, `${TEST_SLUG}-2`, 'index.md');
    expect(fs.existsSync(dupFlatPath)).toBe(false);
    expect(fs.existsSync(dupDirPath)).toBe(false);
  });
});
