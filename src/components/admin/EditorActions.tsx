import { useEffect } from 'preact/hooks';
import SaveSuccessModal from './SaveSuccessModal';

interface Props {
  error?: string;
  githubUrl?: string;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  /** Label for conflict notice: "route", "event", "place" */
  contentType?: string;
  /** Role determines guest modal vs inline success */
  userRole?: string;
  /** True when a guest session was created during this save (401 retry) */
  guestCreated?: boolean;
  /** Link for "View live" after save */
  viewLink?: string;
  /** Show CC BY-SA license notice (default true) */
  showLicenseNotice?: boolean;
  /** URL for "What does this mean?" link next to license notice */
  licenseDocsUrl?: string;
  /** Extra disabled condition beyond `saving` */
  disabled?: boolean;
  /** Dismiss the saved state (hides modal/success message) */
  onDismiss?: () => void;
  /** When provided, redirect here instead of showing inline success */
  celebrateUrl?: string;
}

function CelebrateRedirect({ url }: { url: string }) {
  useEffect(() => { window.location.href = url; }, [url]);
  return <div class="save-success">Saved. Redirecting...</div>;
}

export default function EditorActions({
  error, githubUrl, saved, saving, onSave,
  contentType, userRole, guestCreated, viewLink,
  showLicenseNotice = true, licenseDocsUrl, disabled = false, onDismiss, celebrateUrl,
}: Props) {
  return (
    <div class="editor-actions">
      {error && !githubUrl && <div class="auth-error">{error}</div>}
      {githubUrl && contentType && (
        <div class="conflict-notice">
          <strong>Save blocked — someone else updated this {contentType} while you were editing</strong>
          <p>Your changes are still in the form above — nothing was lost.</p>
          <p><strong>To resolve this:</strong></p>
          <ol>
            <li>Reload the page to see the latest version</li>
            <li>Copy your edits from the form above (they're safe until you navigate away)</li>
            <li>Re-enter your edits on the reloaded page</li>
          </ol>
          <a href={githubUrl} target="_blank" rel="noopener" class="btn-primary"
            style="display: inline-block; margin-top: 0.5rem; text-decoration: none;">
            View changes
          </a>
        </div>
      )}
      {saved && (userRole === 'guest' || guestCreated) && viewLink && (
        <SaveSuccessModal viewLink={viewLink} onClose={onDismiss} />
      )}
      {saved && userRole !== 'guest' && !guestCreated && (
        celebrateUrl
          ? <CelebrateRedirect url={celebrateUrl} />
          : (
            <div class="save-success">
              Saved. Your edit will be live in a few minutes.
              {viewLink && <>{' '}<a href={viewLink}>View live</a></>}
            </div>
          )
      )}
      {showLicenseNotice && (
        <p class="editor-license-notice">
          Your contribution will be shared under{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
          {licenseDocsUrl && <>{' '}<a href={licenseDocsUrl} target="_blank" rel="noopener">What does this mean?</a></>}
        </p>
      )}
      <button type="button" class="btn-primary" onClick={onSave} disabled={saving || disabled}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}
