// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// Standalone Strava import button for the rides list page.
// Imports an activity, stashes data in sessionStorage, then navigates to /admin/rides/new.
import { useState } from 'preact/hooks';
import StravaActivityBrowser from './StravaActivityBrowser';
import type { StravaImportResult } from './StravaActivityBrowser';
import { slugify } from '../../lib/slug';

export default function StravaImport() {
  const [open, setOpen] = useState(false);

  function handleImport(result: StravaImportResult) {
    const dateStr = result.start_date_local?.split('T')[0] || result.start_date?.slice(0, 10) || '';
    sessionStorage.setItem('strava-import', JSON.stringify(result));
    const params = new URLSearchParams({
      name: result.name,
      strava_id: result.strava_id,
      date: dateStr,
      slug: slugify(`${dateStr}-${result.name}`),
    });
    window.location.href = `/admin/rides/new?${params}`;
  }

  if (!open) {
    return (
      <button type="button" class="btn-primary" onClick={() => setOpen(true)}>
        Import from Strava
      </button>
    );
  }

  return (
    <StravaActivityBrowser
      onImport={handleImport}
      onClose={() => setOpen(false)}
    />
  );
}
