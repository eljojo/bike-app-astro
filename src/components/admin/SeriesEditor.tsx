import { useState, useMemo, useCallback, useEffect, useRef } from 'preact/hooks';
import { useHydrated } from '../../lib/hooks';
import { expandSeriesOccurrences, type SeriesOccurrence } from '../../lib/series-utils';
import { parseLocalDate, formatDateStr } from '../../lib/date-utils';
import { fullLocale, defaultLocale as getDefaultLocale } from '../../lib/i18n/locale-utils';
import type { EventSeries, SeriesOccurrenceOverride } from '../../lib/models/event-model';

type SeriesMode = 'recurring' | 'schedule';
type RecurrenceFrequency = 'weekly' | 'biweekly';
type DayName = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

const DAY_NAMES: DayName[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Render a location string as either plain text or — when it's a URL (e.g.
 * Google Calendar puts a Maps URL in LOCATION when an event is bound to a
 * Google Place) — a 🌐 emoji link. Keeps the badge compact when the value
 * is unreadable raw URL text.
 */
function LocationBadge({ value, className }: { value: string; className: string }) {
  if (/^https?:\/\//i.test(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" class={className} title={value}>
        🌐
      </a>
    );
  }
  return <span class={className}>{value}</span>;
}

/** Build localized day option labels using Intl */
function buildDayOptions(intlLocale: string): { value: DayName; label: string }[] {
  return DAY_NAMES.map((name, i) => {
    // Jan 4 2026 is a Sunday — offset by day index to get each weekday
    const d = new Date(2026, 0, 4 + i);
    const label = d.toLocaleString(intlLocale, { weekday: 'long' });
    return { value: name, label: label.charAt(0).toUpperCase() + label.slice(1) };
  });
}

/**
 * Get the first day of the week for a locale.
 * Uses Intl.Locale.getWeekInfo() where available, falls back to Monday.
 */
function getWeekStart(intlLocale: string): number {
  try {
    const loc = new Intl.Locale(intlLocale);
    // getWeekInfo() returns { firstDay: 1-7 } where 1=Mon, 7=Sun
    // Intl.Locale weekInfo API — not yet in all TS libs
    type WeekInfo = { firstDay: number };
    const info = ((loc as Intl.Locale & { getWeekInfo?: () => WeekInfo }).getWeekInfo?.()
      ?? (loc as Intl.Locale & { weekInfo?: WeekInfo }).weekInfo);
    if (info?.firstDay) {
      return info.firstDay === 7 ? 0 : info.firstDay; // convert to JS 0=Sun
    }
  } catch { /* fallback */ }
  return 1; // Monday default — most of the world
}

/** Build localized short day headers starting from the locale's first day of week */
function buildDayHeaders(intlLocale: string, weekStart: number): string[] {
  const headers: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dayIndex = (weekStart + i) % 7;
    const d = new Date(2026, 0, 4 + dayIndex); // Jan 4 2026 = Sunday
    headers.push(d.toLocaleString(intlLocale, { weekday: 'narrow' }));
  }
  return headers;
}

interface Props {
  initialSeries?: EventSeries;
  eventLocation?: string;
  eventStartTime?: string;
  eventMeetTime?: string;
  locale?: string;
  onSeriesChange: (series: EventSeries | undefined, firstDate: string, lastDate: string, isValid: boolean) => void;
}

interface OverrideEntry {
  date: string;
  location?: string;
  start_time?: string;
  meet_time?: string;
  note?: string;
  cancelled?: boolean;
  rescheduled_from?: string;
}

interface PopoverState {
  date: string;
  x: number;
  y: number;
}

function detectMode(series?: EventSeries): SeriesMode {
  if (series?.schedule?.length) return 'schedule';
  return 'recurring';
}

export default function SeriesEditor({ initialSeries, eventLocation, eventStartTime, eventMeetTime, locale, onSeriesChange }: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();

  // Resolve full locale for Intl formatting (e.g. 'en' → 'en-CA')
  const intlLocale = useMemo(() => {
    const loc = locale || getDefaultLocale();
    if (loc.includes('-')) return loc;
    return fullLocale(loc);
  }, [locale]);

  const weekStart = useMemo(() => getWeekStart(intlLocale), [intlLocale]);
  const dayOptions = useMemo(() => buildDayOptions(intlLocale), [intlLocale]);
  const dayHeaders = useMemo(() => buildDayHeaders(intlLocale, weekStart), [intlLocale, weekStart]);

  const [mode, setMode] = useState<SeriesMode>(detectMode(initialSeries));

  // Recurring state
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency>(
    (initialSeries?.recurrence as RecurrenceFrequency) || 'weekly'
  );
  const [recurrenceDay, setRecurrenceDay] = useState<DayName>(
    (initialSeries?.recurrence_day as DayName) || 'tuesday'
  );
  const [seasonStart, setSeasonStart] = useState(initialSeries?.season_start || '');
  const [seasonEnd, setSeasonEnd] = useState(initialSeries?.season_end || '');
  const [skipDates, setSkipDates] = useState<string[]>(initialSeries?.skip_dates || []);
  const [overrides, setOverrides] = useState<OverrideEntry[]>(initialSeries?.overrides || []);

  // Schedule state
  const [schedule, setSchedule] = useState<OverrideEntry[]>(initialSeries?.schedule || []);
  const [newScheduleDate, setNewScheduleDate] = useState('');
  const [newScheduleLocation, setNewScheduleLocation] = useState('');

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (mode === 'recurring' && seasonStart) {
      const d = parseLocalDate(seasonStart);
      return { year: d.getFullYear(), month: d.getMonth() };
    }
    if (mode === 'schedule' && schedule.length > 0) {
      const d = parseLocalDate(schedule[0].date);
      return { year: d.getFullYear(), month: d.getMonth() };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Popover state for clicking a date
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [popoverNote, setPopoverNote] = useState('');
  const [popoverLocation, setPopoverLocation] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reposition popover if it overflows the viewport
  useEffect(() => {
    const el = popoverRef.current;
    if (!el || !popover) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
    }
    if (rect.right > window.innerWidth) {
      el.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    }
  }, [popover]);

  // Build the series object from current state and compute occurrences
  const buildSeries = useCallback((): EventSeries | undefined => {
    if (mode === 'recurring') {
      if (!seasonStart || !seasonEnd) return undefined;
      return {
        recurrence,
        recurrence_day: recurrenceDay,
        season_start: seasonStart,
        season_end: seasonEnd,
        ...(skipDates.length > 0 && { skip_dates: skipDates }),
        ...(overrides.length > 0 && { overrides: overrides as SeriesOccurrenceOverride[] }),
      };
    }
    if (schedule.length === 0) return undefined;
    return {
      schedule: schedule as SeriesOccurrenceOverride[],
    };
  }, [mode, recurrence, recurrenceDay, seasonStart, seasonEnd, skipDates, overrides, schedule]);

  const occurrences = useMemo<SeriesOccurrence[]>(() => {
    const series = buildSeries();
    if (!series) return [];
    return expandSeriesOccurrences({
      location: eventLocation,
      start_time: eventStartTime,
      meet_time: eventMeetTime,
      series,
    });
  }, [buildSeries, eventLocation, eventStartTime, eventMeetTime]);

  // Stable ref for the parent callback — avoids re-render loop when parent
  // creates a new handleSeriesChange on every render (not wrapped in useCallback)
  const onSeriesChangeRef = useRef(onSeriesChange);
  onSeriesChangeRef.current = onSeriesChange;

  // Notify parent whenever series data or occurrences change
  const activeOccurrences = useMemo(
    () => occurrences.filter(o => !o.cancelled),
    [occurrences]
  );

  useEffect(() => {
    const series = buildSeries();
    if (!series || activeOccurrences.length === 0) {
      onSeriesChangeRef.current(series, '', '', false);
      return;
    }
    const firstDate = activeOccurrences[0].date;
    const lastDate = activeOccurrences[activeOccurrences.length - 1].date;
    onSeriesChangeRef.current(series, firstDate, lastDate, true);
  }, [buildSeries, activeOccurrences]);

  // Build sets for quick lookup in calendar
  const occurrenceDateSet = useMemo(() => new Set(occurrences.map(o => o.date)), [occurrences]);
  const skipDateSet = useMemo(() => new Set(skipDates), [skipDates]);
  const overrideDateMap = useMemo(() => new Map(overrides.map(o => [o.date, o])), [overrides]);
  const cancelledDateSet = useMemo(
    () => new Set(occurrences.filter(o => o.cancelled).map(o => o.date)),
    [occurrences]
  );
  const overriddenDateSet = useMemo(() => {
    if (mode === 'recurring') {
      return new Set(overrides.filter(o => !o.cancelled).map(o => o.date));
    }
    // In schedule mode, entries with overridden fields count
    return new Set(
      schedule.filter(s => s.note || s.cancelled).map(s => s.date)
    );
  }, [mode, overrides, schedule]);

  // Calendar rendering helpers
  function renderMonthGrid(year: number, month: number) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay(); // 0=Sun
    const totalDays = lastDay.getDate();

    const monthName = firstDay.toLocaleString(intlLocale, { month: 'long', year: 'numeric' });

    // Offset from week start: how many empty cells before day 1
    const emptyBefore = (startDow - weekStart + 7) % 7;

    const cells: Array<{ day: number; dateStr: string } | null> = [];
    for (let i = 0; i < emptyBefore; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = formatDateStr(new Date(year, month, d));
      cells.push({ day: d, dateStr });
    }

    return (
      <div class="series-month">
        <div class="series-month-name">{monthName}</div>
        <div class="series-month-grid">
          {dayHeaders.map((h, i) => <div key={i} class="series-day-header">{h}</div>)}
          {cells.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} class="series-day-cell" />;
            const { day, dateStr } = cell;
            const isOccurrence = occurrenceDateSet.has(dateStr);
            const isSkipped = skipDateSet.has(dateStr);
            const isCancelled = cancelledDateSet.has(dateStr);
            const isOverridden = overriddenDateSet.has(dateStr);

            let dotClass = 'series-day-cell';
            if (isCancelled) dotClass += ' series-day--cancelled';
            else if (isSkipped) dotClass += ' series-day--skipped';
            else if (isOverridden) dotClass += ' series-day--overridden';
            else if (isOccurrence) dotClass += ' series-day--active';

            return (
              <button
                key={dateStr}
                type="button"
                class={dotClass}
                onClick={(e) => {
                  if (isOccurrence || isSkipped || isCancelled) {
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    const override = overrideDateMap.get(dateStr);
                    setPopoverNote(override?.note || '');
                    setPopoverLocation(override?.location || '');
                    setPopover({ date: dateStr, x: rect.left, y: rect.bottom + 4 });
                  } else if (mode === 'schedule') {
                    // In schedule mode, clicking an empty day adds it
                    setSchedule(prev => {
                      const next = [...prev, { date: dateStr }].sort((a, b) => a.date.localeCompare(b.date));
                      return next;
                    });
                  }
                }}
              >
                <span class="series-day-num">{day}</span>
                {(isOccurrence || isSkipped || isCancelled) && <span class="series-day-dot" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function handlePopoverAction(action: 'skip' | 'cancel' | 'override' | 'remove') {
    if (!popover) return;
    const { date } = popover;

    if (mode === 'recurring') {
      switch (action) {
        case 'skip':
          if (!skipDates.includes(date)) {
            setSkipDates([...skipDates, date]);
          }
          setOverrides(overrides.filter(o => o.date !== date));
          break;
        case 'cancel':
          setSkipDates(skipDates.filter(d => d !== date));
          setOverrides(prev => {
            const existing = prev.find(o => o.date === date);
            if (existing) return prev.map(o => o.date === date ? { ...o, cancelled: true } : o);
            return [...prev, { date, cancelled: true }];
          });
          break;
        case 'override':
          setSkipDates(skipDates.filter(d => d !== date));
          setOverrides(prev => {
            const existing = prev.find(o => o.date === date);
            const entry: OverrideEntry = {
              date,
              ...(popoverLocation && { location: popoverLocation }),
              ...(popoverNote && { note: popoverNote }),
            };
            if (existing) return prev.map(o => o.date === date ? entry : o);
            return [...prev, entry];
          });
          break;
        case 'remove':
          setSkipDates(skipDates.filter(d => d !== date));
          setOverrides(overrides.filter(o => o.date !== date));
          break;
      }
    } else {
      // Schedule mode
      switch (action) {
        case 'cancel':
          setSchedule(schedule.map(s =>
            s.date === date ? { ...s, cancelled: true } : s
          ));
          break;
        case 'override':
          setSchedule(schedule.map(s =>
            s.date === date ? {
              ...s,
              ...(popoverLocation && { location: popoverLocation }),
              ...(popoverNote && { note: popoverNote }),
              cancelled: undefined,
            } : s
          ));
          break;
        case 'remove':
          setSchedule(schedule.filter(s => s.date !== date));
          break;
      }
    }
    setPopover(null);
  }

  function addScheduleEntry() {
    if (!newScheduleDate) return;
    if (schedule.some(s => s.date === newScheduleDate)) return;
    const entry: OverrideEntry = {
      date: newScheduleDate,
      ...(newScheduleLocation && { location: newScheduleLocation }),
    };
    setSchedule(
      [...schedule, entry].sort((a, b) => a.date.localeCompare(b.date))
    );
    setNewScheduleDate('');
    setNewScheduleLocation('');
  }

  // Navigate months
  function prevMonth() {
    setCalendarMonth(prev => {
      const d = new Date(prev.year, prev.month - 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function nextMonth() {
    setCalendarMonth(prev => {
      const d = new Date(prev.year, prev.month + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  // Render two months
  const month2 = new Date(calendarMonth.year, calendarMonth.month + 1, 1);

  return (
    <div class="series-editor" ref={hydratedRef}>
      <div class="series-mode-tabs">
        <button
          type="button"
          class={`series-mode-tab${mode === 'recurring' ? ' series-mode-tab--active' : ''}`}
          onClick={() => setMode('recurring')}
        >
          Recurring
        </button>
        <button
          type="button"
          class={`series-mode-tab${mode === 'schedule' ? ' series-mode-tab--active' : ''}`}
          onClick={() => setMode('schedule')}
        >
          Specific dates
        </button>
      </div>

      <div class="series-editor-body">
        <div class="series-editor-fields">
          {mode === 'recurring' && (
            <div class="auth-form">
              <div class="form-field">
                <label for="series-frequency">Frequency</label>
                <select
                  id="series-frequency"
                  value={recurrence}
                  onChange={(e) => setRecurrence((e.target as HTMLSelectElement).value as RecurrenceFrequency)}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                </select>
              </div>
              <div class="form-field">
                <label for="series-day">Day</label>
                <select
                  id="series-day"
                  value={recurrenceDay}
                  onChange={(e) => setRecurrenceDay((e.target as HTMLSelectElement).value as DayName)}
                >
                  {dayOptions.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div class="form-field">
                <label for="series-season-start">Season start</label>
                <input
                  id="series-season-start"
                  type="date"
                  value={seasonStart}
                  onInput={(e) => setSeasonStart((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="form-field">
                <label for="series-season-end">Season end</label>
                <input
                  id="series-season-end"
                  type="date"
                  value={seasonEnd}
                  onInput={(e) => setSeasonEnd((e.target as HTMLInputElement).value)}
                />
              </div>

              {skipDates.length > 0 && (
                <div class="form-field">
                  <label>Skipped dates</label>
                  <div class="series-skip-list">
                    {skipDates.map(d => (
                      <span key={d} class="series-skip-pill">
                        {d}
                        <button type="button" onClick={() => setSkipDates(skipDates.filter(s => s !== d))}>
                          {'×'}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {overrides.length > 0 && (
                <div class="form-field">
                  <label>Overrides</label>
                  <div class="series-override-list">
                    {overrides.map(o => (
                      <div key={o.date} class="series-override-item">
                        <span>{o.date}</span>
                        {o.cancelled && <span class="series-override-badge series-override-badge--cancelled">cancelled</span>}
                        {o.location && <LocationBadge value={o.location} className="series-override-badge" />}
                        {o.note && <span class="series-override-badge">{o.note}</span>}
                        <button type="button" class="btn-link" onClick={() => setOverrides(overrides.filter(x => x.date !== o.date))}>
                          remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === 'schedule' && (
            <div class="auth-form">
              <div class="series-schedule-add">
                <div class="form-field">
                  <label for="series-new-date">Add date</label>
                  <input
                    id="series-new-date"
                    type="date"
                    value={newScheduleDate}
                    onInput={(e) => setNewScheduleDate((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div class="form-field">
                  <label for="series-new-location">Location (optional)</label>
                  <input
                    id="series-new-location"
                    type="text"
                    value={newScheduleLocation}
                    placeholder="e.g. Overbrook CC, 33 Quill"
                    onInput={(e) => setNewScheduleLocation((e.target as HTMLInputElement).value)}
                  />
                </div>
                <button type="button" class="btn btn-small" onClick={addScheduleEntry} disabled={!newScheduleDate}>
                  Add
                </button>
              </div>

              {schedule.length > 0 && (
                <div class="series-schedule-list">
                  {schedule.map(s => (
                    <div key={s.date} class={`series-schedule-item${s.cancelled ? ' series-schedule-item--cancelled' : ''}`}>
                      <span class="series-schedule-date">{s.date}</span>
                      {s.location && <LocationBadge value={s.location} className="series-schedule-location" />}
                      {s.cancelled && <span class="series-override-badge series-override-badge--cancelled">cancelled</span>}
                      {s.note && <span class="series-override-badge">{s.note}</span>}
                      <button type="button" class="btn-link" onClick={() => setSchedule(schedule.filter(x => x.date !== s.date))}>
                        remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p class="series-hint">Click empty calendar days to add dates.</p>
            </div>
          )}
        </div>

        <div class="series-calendar">
          <div class="series-calendar-nav">
            <button type="button" class="btn-link" onClick={prevMonth}>{'< Prev'}</button>
            <button type="button" class="btn-link" onClick={nextMonth}>{'Next >'}</button>
          </div>
          <div class="series-calendar-months">
            {renderMonthGrid(calendarMonth.year, calendarMonth.month)}
            {renderMonthGrid(month2.getFullYear(), month2.getMonth())}
          </div>
          <div class="series-calendar-legend">
            <span class="series-legend-item"><span class="series-day-dot series-legend-dot--active" /> Active</span>
            <span class="series-legend-item"><span class="series-day-dot series-legend-dot--skipped" /> Skipped</span>
            <span class="series-legend-item"><span class="series-day-dot series-legend-dot--overridden" /> Override</span>
            <span class="series-legend-item"><span class="series-day-dot series-legend-dot--cancelled" /> Cancelled</span>
          </div>
          {occurrences.length > 0 && (
            <div class="series-occurrence-count">
              {occurrences.filter(o => !o.cancelled).length} occurrence{occurrences.filter(o => !o.cancelled).length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Date popover */}
      {popover && (
        <div class="series-popover-backdrop" onClick={() => setPopover(null)}>
          <div
            ref={popoverRef}
            class="series-popover"
            style={{ position: 'fixed', left: `${popover.x}px`, top: `${popover.y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="series-popover-title">{popover.date}</div>
            <div class="form-field">
              <label>Location</label>
              <input
                type="text"
                value={popoverLocation}
                onInput={(e) => setPopoverLocation((e.target as HTMLInputElement).value)}
                placeholder="Override location"
              />
            </div>
            <div class="form-field">
              <label>Note</label>
              <input
                type="text"
                value={popoverNote}
                onInput={(e) => setPopoverNote((e.target as HTMLInputElement).value)}
                placeholder="e.g. Special edition"
              />
            </div>
            <div class="series-popover-actions">
              {mode === 'recurring' && !skipDateSet.has(popover.date) && (
                <button type="button" class="btn btn-small" onClick={() => handlePopoverAction('skip')}>Skip</button>
              )}
              <button type="button" class="btn btn-small" onClick={() => handlePopoverAction('cancel')}>Cancel date</button>
              <button type="button" class="btn btn-small btn-primary" onClick={() => handlePopoverAction('override')}>Save override</button>
              <button type="button" class="btn-link" onClick={() => handlePopoverAction('remove')}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
