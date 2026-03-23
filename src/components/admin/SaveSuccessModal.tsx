import InlineUpgradeForm from './InlineUpgradeForm';

interface Props {
  onClose?: () => void;
  viewLink: string;
  locale?: string;
}

export default function SaveSuccessModal({ onClose, viewLink, locale }: Props) {
  const handleClose = onClose ?? (() => {});
  return (
    <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div class="modal-content">
        <h2>Thanks for your contribution</h2>
        <p>
          Your edit has been saved and will be live in a few minutes.
          {' '}<a href={viewLink}>View live</a>
        </p>
        <InlineUpgradeForm locale={locale} />
        <button type="button" class="btn-secondary" onClick={handleClose}>
          Continue editing
        </button>
      </div>
    </div>
  );
}
