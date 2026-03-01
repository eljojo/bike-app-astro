import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { parseLocalDate } from '../lib/date-utils';

function escapeIcal(text: string): string {
  return text.replace(/[\\;,\n]/g, (m) => {
    if (m === '\n') return '\\n';
    return `\\${m}`;
  });
}

function formatIcalDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

export const GET: APIRoute = async () => {
  const events = await getCollection('events');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ottawa by Bike//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Ottawa by Bike - Cycling Events',
  ];

  for (const event of events) {
    const e = event.data;
    const uid = `${event.id}@ottawabybike.ca`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART;VALUE=DATE:${formatIcalDate(e.start_date)}`);
    if (e.end_date) {
      const endDate = parseLocalDate(e.end_date);
      endDate.setDate(endDate.getDate() + 1);
      const ny = endDate.getFullYear();
      const nm = String(endDate.getMonth() + 1).padStart(2, '0');
      const nd = String(endDate.getDate()).padStart(2, '0');
      lines.push(`DTEND;VALUE=DATE:${ny}${nm}${nd}`);
    }
    lines.push(`SUMMARY:${escapeIcal(e.name)}`);
    if (e.location) lines.push(`LOCATION:${escapeIcal(e.location)}`);
    if (e.registration_url) lines.push(`URL:${e.registration_url}`);
    if (e.distances) lines.push(`DESCRIPTION:${escapeIcal(e.distances)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n'), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
