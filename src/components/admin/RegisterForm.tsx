import { useState } from 'preact/hooks';
import { startRegistration } from '@simplewebauthn/browser';

interface Props {
  isSetup?: boolean;
  returnTo?: string;
}

export default function RegisterForm({ isSetup, returnTo = '/admin' }: Props) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Step 1: Get registration options
      const optionsRes = await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName }),
      });

      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error || 'Failed to get registration options');
      }

      const options = await optionsRes.json();

      // Step 2: Start passkey registration ceremony
      const credential = await startRegistration({ optionsJSON: options });

      // Step 3: Complete registration
      const registerRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName, credential }),
      });

      if (!registerRes.ok) {
        const data = await registerRes.json();
        throw new Error(data.error || 'Registration failed');
      }

      // Success — redirect
      window.location.href = returnTo;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey registration was cancelled');
      } else {
        setError(err.message || 'Registration failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form class="auth-form" onSubmit={handleSubmit}>
      {error && <div class="auth-error">{error}</div>}
      <div class="form-field">
        <label for="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          required
          autoFocus
        />
      </div>
      <div class="form-field">
        <label for="displayName">Display name</label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
          required
        />
      </div>
      <button type="submit" class="btn-primary" disabled={loading}>
        {loading ? 'Creating account...' : 'Create account with passkey'}
      </button>
    </form>
  );
}
