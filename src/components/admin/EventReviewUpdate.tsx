import { useState } from 'preact/hooks';
import { useHydrated } from '../../lib/hooks';
import type { UpdateDiff } from '../../lib/calendar-suggestions/types';

interface Props {
  eventId: string;
  eventName: string;
  organizerName: string;
  organizerSlug: string;
  icsUid: string;
  diff: UpdateDiff;
}

type MasterToggle = 'take' | 'keep';
type OccurrenceToggle = 'take_all' | 'keep_all';
type AdditionToggle = 'add' | 'skip';
type CancellationToggle = 'mark' | 'leave';
type RemovalToggle = 'delete' | 'keep';

export default function EventReviewUpdate(props: Props) {
  const rootRef = useHydrated<HTMLDivElement>();
  const { diff } = props;

  // Toggle state — keyed by field or uid
  const [masterToggles, setMasterToggles] = useState<Record<string, MasterToggle>>(() => {
    const init: Record<string, MasterToggle> = {};
    for (const f of diff.master) init[f.field] = 'take';
    return init;
  });

  const [occurrenceToggles, setOccurrenceToggles] = useState<Record<string, OccurrenceToggle>>(() => {
    const init: Record<string, OccurrenceToggle> = {};
    for (const o of diff.occurrencesChanged) init[o.uid] = 'take_all';
    return init;
  });

  const [additionToggles, setAdditionToggles] = useState<Record<string, AdditionToggle>>(() => {
    const init: Record<string, AdditionToggle> = {};
    for (const o of diff.occurrencesAdded) {
      const key = o.uid ?? o.date;
      init[key] = 'add';
    }
    return init;
  });

  const [cancellationToggles, setCancellationToggles] = useState<Record<string, CancellationToggle>>(() => {
    const init: Record<string, CancellationToggle> = {};
    for (const o of diff.occurrencesNewlyCancelled) init[o.uid] = 'mark';
    return init;
  });

  const [removalToggles, setRemovalToggles] = useState<Record<string, RemovalToggle>>(() => {
    const init: Record<string, RemovalToggle> = {};
    for (const o of diff.occurrencesRemoved) init[o.uid] = 'keep';  // destructive — opt-in
    return init;
  });

  const [error, setError] = useState<string | null>(null);

  // Build the payload for the apply endpoint
  function buildPayload(next: 'back' | 'editor') {
    // master: field -> 'take' | 'keep'
    const master: Record<string, 'take' | 'keep'> = {};
    for (const [field, toggle] of Object.entries(masterToggles)) {
      master[field] = toggle;
    }

    // occurrences: uid -> { takeAll, fields }
    const occurrences: Record<string, { takeAll: boolean; fields?: Record<string, 'take' | 'keep'> }> = {};
    for (const [uid, toggle] of Object.entries(occurrenceToggles)) {
      occurrences[uid] = { takeAll: toggle === 'take_all' };
    }

    // additions: uid -> 'add' | 'skip'
    const additions: Record<string, 'add' | 'skip'> = {};
    for (const [uid, toggle] of Object.entries(additionToggles)) {
      additions[uid] = toggle;
    }

    // cancellations: uid -> 'mark' | 'leave'
    const cancellations: Record<string, 'mark' | 'leave'> = {};
    for (const [uid, toggle] of Object.entries(cancellationToggles)) {
      cancellations[uid] = toggle;
    }

    // removals: uid -> 'delete' | 'keep'
    const removals: Record<string, 'delete' | 'keep'> = {};
    for (const [uid, toggle] of Object.entries(removalToggles)) {
      removals[uid] = toggle;
    }

    return { master, occurrences, additions, cancellations, removals, next };
  }

  async function onApply(next: 'back' | 'editor') {
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(props.eventId)}/review-update/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(next)),
      });
      if (!res.ok) {
        setError('Apply failed. Please try again.');
        return;
      }
      const json = await res.json() as { ok: boolean; redirectTo: string };
      window.location.href = json.redirectTo;
    } catch {
      setError('Network error. Please try again.');
    }
  }

  async function onDismiss() {
    setError(null);
    try {
      const res = await fetch('/api/admin/calendar-suggestions/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'review',
          organizer_slug: props.organizerSlug,
          uid: props.icsUid,
          event_id: props.eventId,
        }),
      });
      if (!res.ok) {
        setError('Dismiss failed. Please try again.');
        return;
      }
      window.location.href = '/admin/events';
    } catch {
      setError('Network error. Please try again.');
    }
  }

  return (
    <div ref={rootRef} class="review-update">
      <header class="review-update__header">
        <a href="/admin/events" class="review-update__back">← Back to events</a>
        <h1>{props.eventName}</h1>
        <p class="review-update__sub">{props.organizerName}</p>
      </header>

      {diff.master.length > 0 && (
        <section>
          <h2>Whole-series fields ({diff.master.length})</h2>
          <ul>
            {diff.master.map(f => (
              <li key={f.field} class="review-update__row">
                <strong>{f.field}</strong>
                <div class="review-update__values">
                  <span>Mine: <code>{f.mine ?? '∅'}</code></span>
                  <span>Upstream: <code>{f.upstream ?? '∅'}</code></span>
                </div>
                <div class="review-update__toggle">
                  <label>
                    <input
                      type="radio"
                      name={`master-${f.field}`}
                      value="take"
                      checked={masterToggles[f.field] === 'take'}
                      onChange={() => setMasterToggles(prev => ({ ...prev, [f.field]: 'take' }))}
                    />
                    {' '}Take upstream
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`master-${f.field}`}
                      value="keep"
                      checked={masterToggles[f.field] === 'keep'}
                      onChange={() => setMasterToggles(prev => ({ ...prev, [f.field]: 'keep' }))}
                    />
                    {' '}Keep mine
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff.occurrencesChanged.length > 0 && (
        <section>
          <h2>Per-occurrence changes ({diff.occurrencesChanged.length})</h2>
          <ul>
            {diff.occurrencesChanged.map(o => (
              <li key={o.uid} class="review-update__row">
                <strong>{o.date}</strong>
                <div class="review-update__values">
                  {o.fields.map(f => (
                    <span key={f.field}>{f.field}: <code>{f.mine ?? '∅'}</code> → <code>{f.upstream ?? '∅'}</code></span>
                  ))}
                </div>
                <div class="review-update__toggle">
                  <label>
                    <input
                      type="radio"
                      name={`occ-${o.uid}`}
                      value="take_all"
                      checked={occurrenceToggles[o.uid] === 'take_all'}
                      onChange={() => setOccurrenceToggles(prev => ({ ...prev, [o.uid]: 'take_all' }))}
                    />
                    {' '}Take all upstream changes
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`occ-${o.uid}`}
                      value="keep_all"
                      checked={occurrenceToggles[o.uid] === 'keep_all'}
                      onChange={() => setOccurrenceToggles(prev => ({ ...prev, [o.uid]: 'keep_all' }))}
                    />
                    {' '}Keep mine
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff.occurrencesAdded.length > 0 && (
        <section>
          <h2>New dates ({diff.occurrencesAdded.length})</h2>
          <ul>
            {diff.occurrencesAdded.map(o => {
              const key = o.uid ?? o.date;
              return (
                <li key={key} class="review-update__row">
                  <strong>{o.date}</strong>
                  {o.location && <span> — {o.location}</span>}
                  <div class="review-update__toggle">
                    <label>
                      <input
                        type="radio"
                        name={`add-${key}`}
                        value="add"
                        checked={additionToggles[key] === 'add'}
                        onChange={() => setAdditionToggles(prev => ({ ...prev, [key]: 'add' }))}
                      />
                      {' '}Add
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`add-${key}`}
                        value="skip"
                        checked={additionToggles[key] === 'skip'}
                        onChange={() => setAdditionToggles(prev => ({ ...prev, [key]: 'skip' }))}
                      />
                      {' '}Skip
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {diff.occurrencesNewlyCancelled.length > 0 && (
        <section>
          <h2>Newly cancelled ({diff.occurrencesNewlyCancelled.length})</h2>
          <ul>
            {diff.occurrencesNewlyCancelled.map(o => (
              <li key={o.uid} class="review-update__row">
                <strong>{o.date}</strong>
                {o.fields.length > 0 && (
                  <ul class="review-update__sub-fields">
                    {o.fields.map(f => (
                      <li key={f.field}>
                        {f.field}: <code>{f.mine ?? '∅'}</code> → <code>{f.upstream ?? '∅'}</code>
                      </li>
                    ))}
                  </ul>
                )}
                <div class="review-update__toggle">
                  <label>
                    <input
                      type="radio"
                      name={`cancel-${o.uid}`}
                      value="mark"
                      checked={cancellationToggles[o.uid] === 'mark'}
                      onChange={() => setCancellationToggles(prev => ({ ...prev, [o.uid]: 'mark' }))}
                    />
                    {' '}Mark cancelled
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`cancel-${o.uid}`}
                      value="leave"
                      checked={cancellationToggles[o.uid] === 'leave'}
                      onChange={() => setCancellationToggles(prev => ({ ...prev, [o.uid]: 'leave' }))}
                    />
                    {' '}Leave as-is
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(diff.occurrencesRemoved.length > 0 || diff.eventRemoved) && (
        <section>
          <h2>Removed upstream</h2>
          {diff.eventRemoved ? (
            <p>The whole event has been removed from the upstream calendar.</p>
          ) : (
            <ul>
              {diff.occurrencesRemoved.map(o => (
                <li key={o.uid} class="review-update__row">
                  <strong>{o.date}</strong>
                  <div class="review-update__toggle">
                    <label>
                      <input
                        type="radio"
                        name={`remove-${o.uid}`}
                        value="keep"
                        checked={removalToggles[o.uid] === 'keep'}
                        onChange={() => setRemovalToggles(prev => ({ ...prev, [o.uid]: 'keep' }))}
                      />
                      {' '}Keep
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`remove-${o.uid}`}
                        value="delete"
                        checked={removalToggles[o.uid] === 'delete'}
                        onChange={() => setRemovalToggles(prev => ({ ...prev, [o.uid]: 'delete' }))}
                      />
                      {' '}Delete
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && (
        <div class="review-update__error" role="alert">
          {error}
        </div>
      )}

      <div class="review-update__actions">
        <button type="button" onClick={() => onApply('back')}>Apply selected</button>
        <button type="button" onClick={() => onApply('editor')}>Tweak in editor</button>
        <button type="button" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
