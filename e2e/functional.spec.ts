import { test, expect } from '@playwright/test';

// GPX downloads — verify .gpx files are served with correct content type.
test.describe('GPX downloads', () => {
  test('route GPX download returns valid GPX', async ({ request }) => {
    const response = await request.get('/routes/ruta-rio-chillan/default.gpx');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/gpx+xml');
    const body = await response.text();
    expect(body).toContain('<gpx');
    expect(body).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
  });
});
