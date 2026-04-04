import { useState } from 'preact/hooks';
import { startRegistration } from '@simplewebauthn/browser';

interface Props {
  isSetup?: boolean;
  isUpgrade?: boolean;
  returnTo?: string;
}

export default function RegisterForm({ isSetup: _isSetup, isUpgrade, returnTo = '/admin' }: Props) {
  const [email, setEmail] = useState('');
  const [username, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Step 1: Get registration options
      const optionsUrl = isUpgrade ? '/api/auth/upgrade-options' : '/api/auth/register-options';
      const optionsRes = await fetch(optionsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username }),
      });

      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error || 'Failed to get registration options');
      }

      const options = await optionsRes.json();

      // Step 2: Start passkey registration ceremony
      const credential = await startRegistration({ optionsJSON: options });

      // Step 3: Complete registration
      const completeUrl = isUpgrade ? '/api/auth/upgrade' : '/api/auth/register';
      const registerRes = await fetch(completeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, credential }),
      });

      if (!registerRes.ok) {
        const data = await registerRes.json();
        throw new Error(data.error || 'Registration failed');
      }

      // Success — redirect
      window.location.href = returnTo;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Passkey registration was cancelled');
      } else {
        setError(err instanceof Error ? err.message : 'Registration failed');
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
        <label for="username">Username</label>
        <input
          id="username"
          type="text"
          value={username}
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
