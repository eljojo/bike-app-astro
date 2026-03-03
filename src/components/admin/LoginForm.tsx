import { useState } from 'preact/hooks';
import { startAuthentication } from '@simplewebauthn/browser';

interface Props {
  returnTo?: string;
}

export default function LoginForm({ returnTo = '/admin' }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Step 1: Get login options
      const optionsRes = await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error || 'Failed to get login options');
      }

      const options = await optionsRes.json();

      // Step 2: Start passkey ceremony
      const credential = await startAuthentication({ optionsJSON: options });

      // Step 3: Verify with server
      const verifyRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, credential }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || 'Login failed');
      }

      // Success — redirect
      window.location.href = returnTo;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey authentication was cancelled');
      } else {
        setError(err.message || 'Login failed');
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
          autoComplete="email webauthn"
          autoFocus
        />
      </div>
      <button type="submit" class="btn-primary" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign in with passkey'}
      </button>
    </form>
  );
}
