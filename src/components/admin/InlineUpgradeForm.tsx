import { useState, useEffect } from 'preact/hooks';
import { generateUsernameFromEmail, isValidUsername } from '../../lib/username';

type FormState = 'form' | 'sending' | 'sent' | 'error';

interface Props {
  locale?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function InlineUpgradeForm({ locale: _locale }: Props) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [formState, setFormState] = useState<FormState>('form');
  const [errorMessage, setErrorMessage] = useState('');

  // Update Gravatar when email changes (debounced)
  useEffect(() => {
    if (!email || !email.includes('@')) {
      setAvatarUrl('');
      return;
    }

    const timer = setTimeout(async () => {
      const hash = await sha256Hex(email.trim().toLowerCase());
      setAvatarUrl(`https://www.gravatar.com/avatar/${hash}?d=mp&s=80`);
    }, 300);

    return () => clearTimeout(timer);
  }, [email]);

  function handleEmailBlur() {
    if (email.trim() && email.includes('@') && !username) {
      setUsername(generateUsernameFromEmail(email.trim()));
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setErrorMessage('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMessage('A valid email is required');
      setFormState('error');
      return;
    }

    if (!isValidUsername(username)) {
      setErrorMessage('Username must be 2-30 characters: letters, numbers, hyphens, underscores');
      setFormState('error');
      return;
    }

    setFormState('sending');

    try {
      const res = await fetch('/api/auth/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, username }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upgrade failed');
      }

      setFormState('sent');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong');
      setFormState('error');
    }
  }

  if (formState === 'sent') {
    return (
      <div class="inline-upgrade-form">
        <div class="upgrade-confirmation">
          {avatarUrl && (
            <div class="upgrade-gravatar">
              <img src={avatarUrl} alt="" width="48" height="48" />
            </div>
          )}
          <p>Check your email to finish setting up your account.</p>
        </div>
      </div>
    );
  }

  return (
    <div class="inline-upgrade-form">
      <p class="upgrade-prompt">
        Keep your contributions — add an email to create your account.
      </p>
      <form onSubmit={handleSubmit}>
        {(formState === 'error') && errorMessage && (
          <div class="auth-error">{errorMessage}</div>
        )}

        {avatarUrl && (
          <div class="upgrade-gravatar">
            <img src={avatarUrl} alt="" width="48" height="48" />
          </div>
        )}

        <div class="form-field">
          <label for="upgrade-email">Email</label>
          <input
            id="upgrade-email"
            type="email"
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            onBlur={handleEmailBlur}
            required
            disabled={formState === 'sending'}
            placeholder="you@example.com"
          />
        </div>

        <div class="form-field">
          <label for="upgrade-username">Username</label>
          <input
            id="upgrade-username"
            type="text"
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            required
            autoComplete="off"
            disabled={formState === 'sending'}
            placeholder="your-username"
          />
          <p class="auth-field-hint">This will appear on your contributions.</p>
        </div>

        <button type="submit" class="btn-primary" disabled={formState === 'sending'}>
          {formState === 'sending' ? 'Sending...' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
