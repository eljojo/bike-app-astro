import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { parseLocalDate } from '../lib/date-utils';
import { getCityConfig } from '../lib/config/city-config';

export const prerender = true;

function escapeIcal(text: string): string {
  return text.replace(/[\\;,\n]/g, (m) => {
    if (m === '\n') return '\\n';
    return `\\${m}`;
  });
}

function formatIcalDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

function formatIcalTime(timeStr: string): string {
  return timeStr.replace(/:/g, '') + '00';
}

function addOneHour(dateStr: string, timeStr: string): { date: string; time: string } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(year, month - 1, day, hours + 1, minutes);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${dd}`, time: `${hh}:${mm}` };
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
    'BEGIN:VTIMEZONE',
    `TZID:${config.timezone}`,
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
    const uid = `${event.id}@${config.domain}`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (e.start_time) {
      lines.push(`DTSTART;TZID=${config.timezone}:${formatIcalDate(e.start_date)}T${formatIcalTime(e.start_time)}`);
      if (e.end_date && e.end_time) {
        lines.push(`DTEND;TZID=${config.timezone}:${formatIcalDate(e.end_date)}T${formatIcalTime(e.end_time)}`);
      } else {
        const fallback = addOneHour(e.start_date, e.start_time);
        lines.push(`DTEND;TZID=${config.timezone}:${formatIcalDate(fallback.date)}T${formatIcalTime(fallback.time)}`);
      }
    } else {
      lines.push(`DTSTART;VALUE=DATE:${formatIcalDate(e.start_date)}`);
      if (e.end_date) {
        const endDate = parseLocalDate(e.end_date);
        endDate.setDate(endDate.getDate() + 1);
        const ny = endDate.getFullYear();
        const nm = String(endDate.getMonth() + 1).padStart(2, '0');
        const nd = String(endDate.getDate()).padStart(2, '0');
        lines.push(`DTEND;VALUE=DATE:${ny}${nm}${nd}`);
      }
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
