interface Props {
  onClose: () => void;
  prUrl?: string;
  isGuest?: boolean;
}

export default function SaveSuccessModal({ onClose, prUrl, isGuest }: Props) {
  return (
    <div class="modal-overlay" onClick={(e) => {
      if ((e.target as HTMLElement).classList.contains('modal-overlay')) onClose();
    }}>
      <div class="modal-content">
        <h2>Thanks for your contribution!</h2>
        <p>
          Your suggestion has been submitted. Our curators will review your
          changes and publish them once approved.
        </p>
        {prUrl && (
          <p>
            <a href={prUrl} target="_blank" rel="noopener">
              View your submission on GitHub
            </a>
          </p>
        )}
        {isGuest && (
          <p class="modal-cta">
            <a href="/register" class="btn-primary">Create an account</a>
            <span class="modal-cta-hint">Track your contributions and get notified</span>
          </p>
        )}
        <button type="button" class="btn-secondary" onClick={onClose}>
          Continue editing
        </button>
      </div>
    </div>
  );
}
