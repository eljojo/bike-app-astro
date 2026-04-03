import { useState, useEffect } from 'preact/hooks';
import { startAuthentication, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { useHydrated } from '../../lib/hooks';
import { generateUsernameFromEmail, isValidUsername } from '../../lib/username';

type FormState =
  | 'idle'
  | 'entering-email'
  | 'needs-username'
  | 'check-email'
  | 'passkey-prompt';

export interface LoginFormLabels {
  signing_in: string;
  sign_in_passkey: string;
  create_account: string;
  email_placeholder: string;
  username_label: string;
  username_placeholder: string;
  username_hint: string;
  back_to_sign_in: string;
  continue: string;
  send_link_instead: string;
  check_email_verify: string;
  check_email_magic_link: string;
  error_email_required: string;
  error_invalid_username: string;
}

interface Props {
  returnTo?: string;
  labels?: LoginFormLabels;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const fallbackLabels: LoginFormLabels = {
  signing_in: 'Signing in...',
  sign_in_passkey: 'Sign in with passkey',
  create_account: 'Create account',
  email_placeholder: 'you@example.com',
  username_label: 'Choose a username',
  username_placeholder: 'your-username',
  username_hint: 'This will appear on your contributions.',
  back_to_sign_in: 'Back to sign in',
  continue: 'Continue',
  send_link_instead: 'Send a sign-in link instead',
  check_email_verify: 'Check your email to verify your account and finish setting up.',
  check_email_magic_link: 'Check your email for a sign-in link. It expires in 15 minutes.',
  error_email_required: 'Email is required',
  error_invalid_username: 'Username must be 2-30 characters: letters, numbers, hyphens, underscores',
};

export default function LoginForm({ returnTo = '/admin', labels }: Props) {
  const l = labels ?? fallbackLabels;
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [formState, setFormState] = useState<FormState>('idle');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [checkEmailMessage, setCheckEmailMessage] = useState('');

  // Conditional UI: on mount, try to start passkey autofill
  useEffect(() => {
    let cancelled = false;

    async function initConditionalUI() {
      try {
        const supported = await browserSupportsWebAuthnAutofill();
        if (!supported || cancelled) return;

        // Get options with empty identifier for discoverable credentials
        const optionsRes = await fetch('/api/auth/login-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (!optionsRes.ok || cancelled) return;

        const options = await optionsRes.json();

        // Start conditional UI — browser will show passkeys in autofill dropdown
        const credential = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });

        if (cancelled) return;

        // User selected a passkey from autofill — verify it
        setLoading(true);
        const verifyRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential }),
        });

        if (!verifyRes.ok) {
          const data = await verifyRes.json();
          setError(data.error || 'Login failed');
          setLoading(false);
          return;
        }

        window.location.href = returnTo;
      } catch {
        // User cancelled, browser doesn't support it, or no credentials — all fine
      }
    }

    initConditionalUI();

    return () => {
      cancelled = true;
    };
  }, [returnTo]);

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

  async function handlePasskeyCeremony(identifier: string) {
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

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(l.error_email_required);
      return;
    }

    // If in needs-username state, submit with username
    if (formState === 'needs-username') {
      if (!isValidUsername(username)) {
        setError(l.error_invalid_username);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail, username }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Sign up failed');
        }

        if (data.flow === 'verify-email') {
          setCheckEmailMessage(l.check_email_verify);
          setFormState('check-email');
        } else if (data.flow === 'magic-link') {
          setCheckEmailMessage(l.check_email_magic_link);
          setFormState('check-email');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Sign up failed');
      } finally {
        setLoading(false);
      }
      return;
    }

    // If in passkey-prompt state, trigger passkey ceremony
    if (formState === 'passkey-prompt') {
      await handlePasskeyCeremony(trimmedEmail);
      return;
    }

    // Default: call /api/auth/signup to determine flow
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      switch (data.flow) {
        case 'passkey':
          setFormState('passkey-prompt');
          setLoading(false);
          // Auto-trigger passkey ceremony
          await handlePasskeyCeremony(trimmedEmail);
          return;

        case 'magic-link':
          setCheckEmailMessage(l.check_email_magic_link);
          setFormState('check-email');
          break;

        case 'verify-email':
          setCheckEmailMessage(l.check_email_verify);
          setFormState('check-email');
          break;

        default:
          // Server returned a flow we don't know about — shouldn't happen
          // but if it does, fall into needs-username for new accounts
          setUsername(generateUsernameFromEmail(trimmedEmail));
          setFormState('needs-username');
          break;
      }
    } catch (err: unknown) {
      // If signup endpoint returned an error because no username was provided
      // for a new account, show the username step
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function handleEmailBlur() {
    if (email.trim() && email.includes('@') && !username) {
      setUsername(generateUsernameFromEmail(email.trim()));
    }
    if (formState === 'idle') {
      setFormState('entering-email');
    }
  }

  // Check-email confirmation screen
  if (formState === 'check-email') {
    return (
      <div ref={hydratedRef}>
        <div class="auth-form">
          {avatarUrl && (
            <div class="auth-avatar">
              <img src={avatarUrl} alt="" width="80" height="80" />
            </div>
          )}
          <div class="auth-success">
            {checkEmailMessage}
          </div>
          <button
            type="button"
            class="auth-mode-toggle"
            onClick={() => {
              setFormState('idle');
              setError('');
            }}
          >
            {l.back_to_sign_in}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={hydratedRef}>
    <form class="auth-form" onSubmit={handleSubmit}>
      {error && <div class="auth-error">{error}</div>}

      {avatarUrl && formState !== 'idle' && (
        <div class="auth-avatar">
          <img src={avatarUrl} alt="" width="80" height="80" />
        </div>
      )}

      <div class="form-field">
        <label for="login-email">Email</label>
        <input
          id="login-email"
          type="text"
          value={email}
          onInput={(e) => {
            setEmail((e.target as HTMLInputElement).value);
            // Reset to entering state if user changes email after a flow was determined
            if (formState === 'passkey-prompt' || formState === 'needs-username') {
              setFormState('entering-email');
              setError('');
            }
          }}
          onBlur={handleEmailBlur}
          required
          autoComplete="username webauthn"
          autoFocus
          disabled={loading}
          placeholder={l.email_placeholder}
        />
      </div>

      {formState === 'needs-username' && (
        <div class="form-field">
          <label for="login-username">{l.username_label}</label>
          <input
            id="login-username"
            type="text"
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            required
            autoComplete="off"
            disabled={loading}
            placeholder={l.username_placeholder}
          />
          <p class="auth-field-hint">{l.username_hint}</p>
        </div>
      )}

      <button type="submit" class="btn-primary" disabled={loading}>
        {loading
          ? l.signing_in
          : formState === 'passkey-prompt'
            ? l.sign_in_passkey
            : formState === 'needs-username'
              ? l.create_account
              : l.continue
        }
      </button>

      {formState === 'passkey-prompt' && (
        <button
          type="button"
          class="auth-mode-toggle"
          onClick={async () => {
            // Fall back to magic link for existing users who can't use their passkey
            setLoading(true);
            setError('');
            try {
              // Re-call signup which will send a magic link for existing users without passkeys
              // But this user HAS a passkey — we need to send them a magic link anyway
              // Use the email-login endpoint directly
              const res = await fetch('/api/auth/email-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
              });

              if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to send sign-in link');
              }

              setCheckEmailMessage(l.check_email_magic_link);
              setFormState('check-email');
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : 'Failed to send sign-in link');
            } finally {
              setLoading(false);
            }
          }}
        >
          {l.send_link_instead}
        </button>
      )}
    </form>
    </div>
  );
}
