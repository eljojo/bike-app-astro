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
  /** Link for "View live" after save */
  viewLink?: string;
  /** Show CC BY-SA license notice (default true) */
  showLicenseNotice?: boolean;
  /** Extra disabled condition beyond `saving` */
  disabled?: boolean;
}

export default function EditorActions({
  error, githubUrl, saved, saving, onSave,
  contentType, userRole, viewLink,
  showLicenseNotice = true, disabled = false,
}: Props) {
  return (
    <div class="editor-actions">
      {error && !githubUrl && <div class="auth-error">{error}</div>}
      {githubUrl && contentType && (
        <div class="conflict-notice">
          <strong>Save blocked — this {contentType} was changed on GitHub</strong>
          <p>Someone modified this {contentType} since you started editing.
            Your changes are still in the form above — nothing was lost.</p>
          <p><strong>To resolve this:</strong></p>
          <ol>
            <li>Open the file on GitHub to see what changed</li>
            <li>Copy your edits from the form above (they're safe until you navigate away)</li>
            <li>Either apply your changes directly on GitHub, or wait for the site to rebuild,
              then reload this page and re-enter your edits</li>
          </ol>
          <a href={githubUrl} target="_blank" rel="noopener" class="btn-primary"
            style="display: inline-block; margin-top: 0.5rem; text-decoration: none;">
            View file on GitHub
          </a>
        </div>
      )}
      {saved && userRole === 'guest' && viewLink && (
        <SaveSuccessModal viewLink={viewLink} />
      )}
      {saved && userRole !== 'guest' && (
        <div class="save-success">
          Saved! Your edit will be live in a few minutes.
          {viewLink && <>{' '}<a href={viewLink}>View live</a></>}
        </div>
      )}
      {showLicenseNotice && (
        <p class="editor-license-notice">
          By saving, you agree to release your contribution under{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
        </p>
      )}
      <button type="button" class="btn-primary" onClick={onSave} disabled={saving || disabled}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}
