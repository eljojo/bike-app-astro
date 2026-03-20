import { useState } from 'preact/hooks';
import { useHydrated } from '../../lib/hooks';
import { startRegistration } from '@simplewebauthn/browser';

interface Passkey {
  id: string;
  credentialId: string;
  createdAt: string;
}

interface StravaStatusData {
  configured: boolean;
  connected: boolean;
  athleteId: string | null;
}

interface Props {
  username: string;
  email: string | null;
  emailHash: string | null;
  emailInCommits: boolean;
  analyticsOptOut: boolean;
  role: 'admin' | 'editor' | 'guest';
  isBlog?: boolean;
  stravaStatus?: StravaStatusData | null;
  passkeys?: Passkey[];
}

export default function SettingsForm({ username: initialUsername, email: initialEmail, emailHash, emailInCommits: initialEmailInCommits, analyticsOptOut: initialAnalyticsOptOut, role, isBlog, stravaStatus: initialStravaStatus, passkeys: initialPasskeys }: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const isGuest = role === 'guest';
  const isAdmin = role === 'admin';
  const [username, setUsername] = useState(initialUsername);
  const [email, setEmail] = useState(initialEmail ?? '');
  const [emailInCommits, setEmailInCommits] = useState(initialEmailInCommits);
  const [analyticsOptOut, setAnalyticsOptOut] = useState(initialAnalyticsOptOut);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Passkey management
  const [passkeys, setPasskeys] = useState<Passkey[]>(initialPasskeys ?? []);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');

  // Strava integration
  const [stravaStatus, setStravaStatus] = useState<StravaStatusData | null>(initialStravaStatus ?? null);
  const [stravaLoading, setStravaLoading] = useState(false);

  const emailModified = email.trim().toLowerCase() !== (initialEmail ?? '').toLowerCase();

  const avatarUrl = emailHash
    ? `https://www.gravatar.com/avatar/${emailHash}?d=mp&s=80`
    : 'https://www.gravatar.com/avatar/?d=mp&s=80';

  async function handleStravaDisconnect() {
    setStravaLoading(true);
    try {
      const res = await fetch('/api/strava/disconnect', { method: 'POST' });
      if (res.ok) setStravaStatus({ configured: true, connected: false, athleteId: null });
    } catch {
      // ignore
    } finally {
      setStravaLoading(false);
    }
  }

  async function handleAddPasskey() {
    setPasskeyError('');
    setPasskeyLoading(true);

    try {
      // Step 1: Get registration options
      const optionsRes = await fetch('/api/auth/add-passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error || 'Failed to get registration options');
      }

      const options = await optionsRes.json();

      // Step 2: Start WebAuthn ceremony
      const credential = await startRegistration({ optionsJSON: options });

      // Step 3: Verify with server
      const verifyRes = await fetch('/api/auth/add-passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error || 'Passkey registration failed');
      }

      const result = await verifyRes.json();
      if (result.passkey) {
        setPasskeys(prev => [...prev, result.passkey]);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setPasskeyError('Passkey registration was cancelled');
      } else {
        setPasskeyError(err instanceof Error ? err.message : 'Failed to add passkey');
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleRemovePasskey(id: string) {
    setPasskeyError('');

    try {
      const res = await fetch('/api/auth/remove-passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove passkey');
      }

      setPasskeys(prev => prev.filter(pk => pk.id !== id));
    } catch (err: unknown) {
      setPasskeyError(err instanceof Error ? err.message : 'Failed to remove passkey');
    }
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isGuest
          ? { analyticsOptOut }
          : { username, email, emailInCommits, analyticsOptOut },
        ),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Save failed');
      }

      // Handle analytics opt-out in localStorage
      if (analyticsOptOut) {
        localStorage.setItem('plausible_ignore', 'true');
      } else {
        localStorage.removeItem('plausible_ignore');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 8000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="settings-form" ref={hydratedRef}>
      {/* Profile card */}
      <div class="settings-card">
        <div class="settings-card-header">Profile</div>
        <div class="settings-card-body">
          {isGuest ? (
            <p class="settings-help" style={{ margin: 0 }}>
              You're browsing as <strong>{initialUsername}</strong>.{' '}
              <a href="/register?join=1">Create an account</a> to choose a username, set an email, and get credit for your contributions.
            </p>
          ) : (
            <div class="settings-profile-row">
              <div class="settings-avatar-col">
                <img
                  src={avatarUrl}
                  alt=""
                  class="settings-avatar"
                  width={80}
                  height={80}
                />
                {emailModified && (
                  <span class="settings-avatar-hint">Updates on save</span>
                )}
              </div>
              <div class="settings-fields">
                <div class="form-field">
                  <label for="settings-email">Email</label>
                  <input
                    id="settings-email"
                    type="email"
                    value={email}
                    placeholder="your@email.com"
                    onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                  />
                  <p class="settings-help">
                    Used for your <a href="https://gravatar.com" target="_blank" rel="noopener noreferrer">Gravatar</a> avatar and optionally for commit attribution.
                  </p>
                </div>
                <div class="form-field">
                  <label for="settings-username">Username</label>
                  <input
                    id="settings-username"
                    type="text"
                    value={username}
                    onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preferences card */}
      <div class="settings-card">
        <div class="settings-card-header">Preferences</div>
        <div class="settings-card-body">
          {!isGuest && (
            <div class="settings-pref-group">
              <label class="settings-checkbox">
                <input
                  type="checkbox"
                  checked={emailInCommits}
                  onChange={(e) => setEmailInCommits((e.target as HTMLInputElement).checked)}
                />
                Include my email in commit history
              </label>
              <p class="settings-help">
                When enabled, your email is used as the commit author so GitHub can link it to your account. Your username still gets credit in contributor stats.
              </p>
              {!email.trim() && (
                <p class="settings-help settings-help--warn">
                  You need to set an email above for this to take effect.
                </p>
              )}
            </div>
          )}

          <div class="settings-pref-group">
            <label class="settings-checkbox">
              <input
                type="checkbox"
                checked={analyticsOptOut}
                onChange={(e) => setAnalyticsOptOut((e.target as HTMLInputElement).checked)}
              />
              Don't count my visits
            </label>
            <p class="settings-help">
              Your page views won't be included in the site's Plausible analytics.
            </p>
          </div>
        </div>
      </div>

      {/* Passkeys card */}
      {!isGuest && (
        <div class="settings-card">
          <div class="settings-card-header">
            Passkeys
            {passkeys.length > 0 && (
              <span class="settings-card-count">{passkeys.length}</span>
            )}
          </div>
          <div class="settings-card-body">
            {passkeyError && <div class="auth-error">{passkeyError}</div>}
            {passkeys.length > 0 ? (
              <ul class="passkey-list">
                {passkeys.map(pk => (
                  <li key={pk.id} class="passkey-item">
                    <span class="passkey-info">
                      <span class="passkey-id">{pk.credentialId.slice(0, 8)}...</span>
                      <span class="passkey-date">Added {new Date(pk.createdAt).toLocaleDateString()}</span>
                    </span>
                    <button
                      type="button"
                      class="btn-small btn-small--danger"
                      onClick={() => handleRemovePasskey(pk.id)}
                      disabled={passkeys.length <= 1 && !email.trim()}
                      title={passkeys.length <= 1 && !email.trim() ? 'Add an email before removing your only passkey' : 'Remove passkey'}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="settings-help" style={{ margin: 0 }}>
                No passkeys yet. Passkeys let you sign in with your fingerprint, face, or security key instead of a password.
              </p>
            )}
            <button
              type="button"
              class="btn-secondary"
              onClick={handleAddPasskey}
              disabled={passkeyLoading}
            >
              {passkeyLoading ? 'Adding...' : '+ Add passkey'}
            </button>
          </div>
        </div>
      )}

      {/* Strava card */}
      {stravaStatus?.configured && isAdmin && (
        <div class="settings-card">
          <div class="settings-card-header">
            Strava
            {stravaStatus.connected && (
              <span class="settings-card-badge settings-card-badge--connected">Connected</span>
            )}
          </div>
          <div class="settings-card-body">
            {stravaStatus.connected ? (
              <>
                <p class="settings-help" style={{ margin: 0 }}>
                  Connected{stravaStatus.athleteId ? ` as athlete ${stravaStatus.athleteId}` : ''}. You can import rides from the <a href="/admin/rides">rides page</a>.
                </p>
                <button
                  type="button"
                  class="btn-small btn-small--danger"
                  onClick={handleStravaDisconnect}
                  disabled={stravaLoading}
                >
                  {stravaLoading ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </>
            ) : (
              <>
                <p class="settings-help" style={{ margin: 0 }}>
                  Connect your Strava account to import rides with GPS data and photos.
                </p>
                <a href="/api/strava/connect" class="btn-primary">
                  Connect Strava
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {/* Save bar */}
      <div class="settings-save-bar">
        {error && <div class="auth-error">{error}</div>}
        {saved && <div class="save-success">Settings saved</div>}
        <button
          type="button"
          class="btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
