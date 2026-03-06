interface Props {
  onClose: () => void;
  viewLink: string;
}

export default function SaveSuccessModal({ onClose, viewLink }: Props) {
  return (
    <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal-content">
        <h2>Thanks for your contribution!</h2>
        <p>
          Your edit has been saved and will be live in a few minutes.
          {' '}<a href={viewLink}>View live</a>
        </p>
        <p class="modal-cta">
          <a href="/register?join=1" class="btn-primary">Create an account</a>
          <span class="modal-cta-hint">Join the community and get credit for your contributions</span>
        </p>
        <button type="button" class="btn-secondary" onClick={onClose}>
          Continue editing
        </button>
      </div>
    </div>
  );
}
