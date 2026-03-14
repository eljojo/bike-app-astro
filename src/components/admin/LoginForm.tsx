import { useState } from 'preact/hooks';
import { startAuthentication } from '@simplewebauthn/browser';

interface Props {
  returnTo?: string;
}

export default function LoginForm({ returnTo = '/admin' }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'passkey' | 'email'>('passkey');
  const [emailSent, setEmailSent] = useState(false);

  async function handlePasskeyLogin(e: Event) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const optionsRes = await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });

      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error || 'Failed to get login options');
      }

      const options = await optionsRes.json();
      const credential = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, credential }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || 'Login failed');
      }

      window.location.href = returnTo;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Passkey authentication was cancelled');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailLogin(e: Event) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/email-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send login email');
      }

      setEmailSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send login email');
    } finally {
      setLoading(false);
    }
  }

  if (emailSent) {
    return (
      <div class="auth-form">
        <div class="auth-success">
          Check your email for a sign-in link. It expires in 15 minutes.
        </div>
        <button type="button" class="auth-mode-toggle" onClick={() => { setEmailSent(false); setMode('passkey'); }}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form class="auth-form" onSubmit={mode === 'passkey' ? handlePasskeyLogin : handleEmailLogin}>
      {error && <div class="auth-error">{error}</div>}
      <div class="form-field">
        <label for="identifier">{mode === 'email' ? 'Email' : 'Email or username'}</label>
        <input
          id="identifier"
          type={mode === 'email' ? 'email' : 'text'}
          value={identifier}
          onInput={(e) => setIdentifier((e.target as HTMLInputElement).value)}
          required
          autoComplete={mode === 'email' ? 'email' : 'username webauthn'}
          autoFocus
        />
      </div>
      <button type="submit" class="btn-primary" disabled={loading}>
        {loading
          ? 'Signing in...'
          : mode === 'passkey'
            ? 'Sign in with passkey'
            : 'Send sign-in link'
        }
      </button>
      <button
        type="button"
        class="auth-mode-toggle"
        onClick={() => { setMode(mode === 'passkey' ? 'email' : 'passkey'); setError(''); }}
      >
        {mode === 'passkey' ? 'Sign in with email instead' : 'Sign in with passkey instead'}
      </button>
    </form>
  );
}
