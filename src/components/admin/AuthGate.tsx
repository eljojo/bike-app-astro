import { useState } from 'preact/hooks';

interface Props {
  returnTo: string;
}

export default function AuthGate({ returnTo }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGuest() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = 'Failed to continue as guest';
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }
      window.location.href = returnTo;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="gate-options">
      {error && <div class="auth-error">{error}</div>}
      <a href={`/login?returnTo=${encodeURIComponent(returnTo)}`} class="btn-primary gate-btn">
        Sign in
      </a>
      <a href={`/register?returnTo=${encodeURIComponent(returnTo)}`} class="btn-primary gate-btn">
        Create account
        <span class="gate-btn-hint">Your edits go live right away</span>
      </a>
      <div class="gate-divider">or</div>
      <button
        type="button"
        class="btn-secondary gate-btn"
        onClick={handleGuest}
        disabled={loading}
      >
        {loading ? 'Setting up...' : 'Continue as guest'}
        <span class="gate-btn-hint">Edits are reviewed before going live</span>
      </button>
    </div>
  );
}
