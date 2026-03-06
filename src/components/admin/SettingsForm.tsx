import { useState } from 'preact/hooks';

interface Props {
  username: string;
  email: string | null;
  emailHash: string | null;
  emailInCommits: boolean;
  analyticsOptOut: boolean;
  role: 'admin' | 'editor' | 'guest';
}

export default function SettingsForm({ username: initialUsername, email: initialEmail, emailHash, emailInCommits: initialEmailInCommits, analyticsOptOut: initialAnalyticsOptOut, role }: Props) {
  const isGuest = role === 'guest';
  const [username, setUsername] = useState(initialUsername);
  const [email, setEmail] = useState(initialEmail ?? '');
  const [emailInCommits, setEmailInCommits] = useState(initialEmailInCommits);
  const [analyticsOptOut, setAnalyticsOptOut] = useState(initialAnalyticsOptOut);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const emailModified = email.trim().toLowerCase() !== (initialEmail ?? '').toLowerCase();

  const avatarUrl = emailHash
    ? `https://www.gravatar.com/avatar/${emailHash}?d=mp&s=80`
    : 'https://www.gravatar.com/avatar/?d=mp&s=80';

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
    <div class="settings-form">
      <h2>Profile</h2>
      {isGuest ? (
        <div class="auth-form">
          <p class="settings-help">
            You're browsing as <strong>{initialUsername}</strong>.{' '}
            <a href="/register?join=1">Create an account</a> to choose a username, set an email, and get credit for your contributions.
          </p>
        </div>
      ) : (
        <>
          <div class="settings-profile">
            <img
              src={avatarUrl}
              alt=""
              class="settings-avatar"
              width={80}
              height={80}
            />
            {emailModified && (
              <p class="settings-help">Gravatar updates on save</p>
            )}
          </div>

          <div class="auth-form">
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
        </>
      )}

      <h2>Preferences</h2>
      <div class="auth-form">
        {!isGuest && (
          <>
            <label class="settings-checkbox">
              <input
                type="checkbox"
                checked={emailInCommits}
                onChange={(e) => setEmailInCommits((e.target as HTMLInputElement).checked)}
              />
              Include my email in commit history
            </label>
            <p class="settings-help">
              Your username always appears on commits. Enabling this adds a Signed-off-by line with your email so GitHub can link the commit to your account.
            </p>
            {!email.trim() && (
              <p class="settings-help settings-help--warn">
                You need to set an email above for this to take effect.
              </p>
            )}
          </>
        )}

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

      <div class="editor-actions">
        {error && <div class="auth-error">{error}</div>}
        {saved && <div class="save-success">Settings saved!</div>}
        <button
          type="button"
          class="btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
