import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getCityConfig } from '../lib/config/city-config';
import { buildVEventLines, foldLine } from '../lib/ical-helpers';

export const prerender = true;

export const GET: APIRoute = async () => {
  const config = getCityConfig();
  const events = await getCollection('events');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${config.display_name}//Calendar//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${config.display_name} - Cycling Events`,
    `X-WR-TIMEZONE:${config.timezone}`,
    `X-WR-CALDESC:${config.tagline}`,
    'X-PUBLISHED-TTL:PT1D',
  ];

  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

  for (const event of events) {
    const vevents = buildVEventLines(
      event as { id: string; data: Record<string, unknown> },
      config.domain,
      config.timezone,
      dtstamp,
    );
    for (const vevent of vevents) {
      lines.push(...vevent.lines);
    }
  }

  lines.push('END:VCALENDAR');

  return new Response(lines.map(foldLine).join('\r\n'), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
