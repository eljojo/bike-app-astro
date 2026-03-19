import { parseLocalDate } from './date-utils';
import { expandSeriesOccurrences, isSeriesEvent } from './series-utils';

export function escapeIcal(text: string): string {
  return text.replace(/[\\;,\n]/g, (m) => {
    if (m === '\n') return '\\n';
    return `\\${m}`;
  });
}

export function formatIcalDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

export function formatIcalTime(timeStr: string): string {
  return timeStr.replace(/:/g, '') + '00';
}

export function addOneHour(dateStr: string, timeStr: string): { date: string; time: string } {
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

export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) {
    parts.push(' ' + line.slice(i, i + 74));
  }
  return parts.join('\r\n');
}

export interface VEventLines {
  uid: string;
  lines: string[];
}

/** Build iCal VEVENT lines for an event (series or one-off). */
export function buildVEventLines(
  event: { id: string; data: Record<string, unknown> },
  domain: string,
  timezone: string,
  dtstamp: string,
): VEventLines[] {
  const e = event.data;
  const results: VEventLines[] = [];

  if (isSeriesEvent(e)) {
    const occurrences = expandSeriesOccurrences(e as Parameters<typeof expandSeriesOccurrences>[0]);
    for (const occ of occurrences) {
      if (occ.cancelled) continue;
      const uid = `${event.id}-${occ.date}@${domain}`;
      const lines: string[] = [];
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtstamp}`);
      const time = occ.start_time;
      if (time) {
        lines.push(`DTSTART;TZID=${timezone}:${formatIcalDate(occ.date)}T${formatIcalTime(time)}`);
        const fallback = addOneHour(occ.date, time);
        lines.push(`DTEND;TZID=${timezone}:${formatIcalDate(fallback.date)}T${formatIcalTime(fallback.time)}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${formatIcalDate(occ.date)}`);
      }
      lines.push(`SUMMARY:${escapeIcal(e.name as string)}`);
      if (occ.location) lines.push(`LOCATION:${escapeIcal(occ.location)}`);
      if (e.registration_url) lines.push(`URL:${e.registration_url as string}`);

      const descParts: string[] = [];
      if (occ.meet_time && time) {
        descParts.push(`Meet: ${occ.meet_time}, Roll: ${time}`);
      }
      if (e.distances) descParts.push(e.distances as string);
      if (descParts.length) lines.push(`DESCRIPTION:${escapeIcal(descParts.join('\\n'))}`);

      lines.push('END:VEVENT');
      results.push({ uid, lines });
    }
    return results;
  }

  const uid = `${event.id}@${domain}`;
  const lines: string[] = [];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${dtstamp}`);
  if (e.start_time) {
    lines.push(`DTSTART;TZID=${timezone}:${formatIcalDate(e.start_date as string)}T${formatIcalTime(e.start_time as string)}`);
    if (e.end_date && e.end_time) {
      lines.push(`DTEND;TZID=${timezone}:${formatIcalDate(e.end_date as string)}T${formatIcalTime(e.end_time as string)}`);
    } else {
      const fallback = addOneHour(e.start_date as string, e.start_time as string);
      lines.push(`DTEND;TZID=${timezone}:${formatIcalDate(fallback.date)}T${formatIcalTime(fallback.time)}`);
    }
  } else {
    lines.push(`DTSTART;VALUE=DATE:${formatIcalDate(e.start_date as string)}`);
    if (e.end_date) {
      const endDate = parseLocalDate(e.end_date as string);
      endDate.setDate(endDate.getDate() + 1);
      const ny = endDate.getFullYear();
      const nm = String(endDate.getMonth() + 1).padStart(2, '0');
      const nd = String(endDate.getDate()).padStart(2, '0');
      lines.push(`DTEND;VALUE=DATE:${ny}${nm}${nd}`);
    }
  }
  lines.push(`SUMMARY:${escapeIcal(e.name as string)}`);
  if (e.location) lines.push(`LOCATION:${escapeIcal(e.location as string)}`);
  if (e.registration_url) lines.push(`URL:${e.registration_url as string}`);
  if (e.distances) lines.push(`DESCRIPTION:${escapeIcal(e.distances as string)}`);
  lines.push('END:VEVENT');
  results.push({ uid, lines });

  return results;
}
