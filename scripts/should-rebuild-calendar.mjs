#!/usr/bin/env node
/**
 * Determines whether a scheduled calendar rebuild is needed by checking
 * if any event ended yesterday. When no events transitioned from upcoming
 * to past, the rebuild is skipped to save CI minutes.
 *
 * Standalone — no npm dependencies, runs with Node.js 22.
 *
 * Outputs `needed=true` or `needed=false` via $GITHUB_OUTPUT.
 */

import { readdir, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONTENT_DIR = process.env.CONTENT_DIR;
const CITY = process.env.CITY || 'ottawa';

if (!CONTENT_DIR) {
  console.error('CONTENT_DIR is required');
  process.exit(1);
}

const eventsDir = join(CONTENT_DIR, CITY, 'events');

// -- Date helpers ----------------------------------------------------------

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's date in Ottawa (America/Toronto) timezone. */
function getToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

/** Yesterday's date in Ottawa (America/Toronto) timezone. */
function getYesterday() {
  const todayStr = getToday();
  const [y, m, d] = todayStr.split('-').map(Number);
  const yesterday = new Date(y, m - 1, d);
  yesterday.setDate(yesterday.getDate() - 1);
  return formatDate(yesterday);
}

// -- Frontmatter parsing ---------------------------------------------------

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

/** Extract all YYYY-MM-DD date strings from frontmatter text. */
function extractDates(frontmatter) {
  return [...frontmatter.matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m => m[0]);
}

/** Extract a simple scalar YAML field value. */
function parseField(text, field) {
  const re = new RegExp(`^\\s*${field}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// -- Recurrence expansion --------------------------------------------------

/** Compute occurrence dates for recurrence-based series. */
function computeRecurrenceDates(frontmatter) {
  const recurrence = parseField(frontmatter, 'recurrence');
  const dayName = parseField(frontmatter, 'recurrence_day');
  const seasonStart = parseField(frontmatter, 'season_start');
  const seasonEnd = parseField(frontmatter, 'season_end');

  if (!recurrence || !dayName || !seasonStart || !seasonEnd) return [];

  const dayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
  if (dayIndex === -1) return [];

  const step = recurrence === 'biweekly' ? 14 : 7;
  const [sy, sm, sd] = seasonStart.split('-').map(Number);
  const [ey, em, ed] = seasonEnd.split('-').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  // Advance to first matching day of week
  while (cursor.getDay() !== dayIndex && cursor <= end) {
    cursor.setDate(cursor.getDate() + 1);
  }

  const dates = [];
  while (cursor <= end) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + step);
  }
  return dates;
}

// -- Main ------------------------------------------------------------------

const yesterday = getYesterday();
const today = getToday();
console.log(`Checking for events on ${today} or ending on ${yesterday}`);

const allDates = new Set();

let years;
try {
  years = await readdir(eventsDir);
} catch {
  console.log('No events directory found — skipping rebuild');
  await setOutput('false');
  process.exit(0);
}

for (const year of years) {
  const yearDir = join(eventsDir, year);
  let entries;
  try {
    entries = await readdir(yearDir, { withFileTypes: true });
  } catch {
    continue;
  }

  for (const entry of entries) {
    let content;
    try {
      if (entry.isDirectory()) {
        content = await readFile(join(yearDir, entry.name, 'index.md'), 'utf8');
      } else if (entry.name.endsWith('.md')) {
        content = await readFile(join(yearDir, entry.name), 'utf8');
      }
    } catch {
      continue;
    }
    if (!content) continue;

    const fm = extractFrontmatter(content);

    // Collect all explicit dates (start_date, end_date, schedule dates, etc.)
    for (const d of extractDates(fm)) {
      allDates.add(d);
    }

    // Expand recurrence-based series into concrete dates
    if (fm.includes('recurrence:')) {
      for (const d of computeRecurrenceDates(fm)) {
        allDates.add(d);
      }
    }
  }
}

const needed = allDates.has(yesterday) || allDates.has(today);
console.log(`Total unique event dates: ${allDates.size}`);
console.log(`Rebuild needed: ${needed}`);

await setOutput(String(needed));

async function setOutput(value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    await appendFile(outputFile, `needed=${value}\n`);
  }
}
