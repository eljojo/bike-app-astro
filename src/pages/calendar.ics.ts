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

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) {
    parts.push(' ' + line.slice(i, i + 74));
  }
  return parts.join('\r\n');
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
    'X-WR-TIMEZONE:America/Toronto',
    'X-WR-CALDESC:Cycling events in Ottawa and Gatineau',
    'X-PUBLISHED-TTL:PT1D',
    'BEGIN:VTIMEZONE',
    'TZID:America/Toronto',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:20070311T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:20071104T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

  for (const event of events) {
    const e = event.data;
    const uid = `${event.id}@ottawabybike.ca`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
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

  return new Response(lines.map(foldLine).join('\r\n'), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
