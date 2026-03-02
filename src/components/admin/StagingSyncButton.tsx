import { useState } from 'preact/hooks';

export default function StagingSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/sync', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setResult({ error: data.error || 'Sync failed' });
        return;
      }

      setResult({ success: true });
    } catch (err: any) {
      setResult({ error: err.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <p class="auth-message" style={{ marginBottom: '0.75rem' }}>
        Reset staging data to match production. This will overwrite all staging edits.
      </p>
      <button
        type="button"
        class="btn-primary"
        onClick={handleSync}
        disabled={syncing}
      >
        {syncing ? 'Syncing...' : 'Sync from production'}
      </button>
      {result?.success && (
        <div class="save-success" style={{ marginTop: '0.5rem' }}>
          Synced! Staging rebuild triggered. Reload after a minute to see fresh data.
        </div>
      )}
      {result?.error && (
        <div class="auth-error" style={{ marginTop: '0.5rem' }}>
          {result.error}
        </div>
      )}
    </div>
  );
}
