import { useState } from 'preact/hooks';
import InlineUpgradeForm from './InlineUpgradeForm';

interface Props {
  onClose?: () => void;
  viewLink: string;
  locale?: string;
}

export default function SaveSuccessModal({ onClose, viewLink, locale }: Props) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const handleClose = onClose ?? (() => {});

  return (
    <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Your anonymous contribution has been saved</h2>
        <p>
          It will be live in a few minutes.
          {' '}<a href={viewLink}>View live</a>
        </p>

        {showUpgrade ? (
          <InlineUpgradeForm locale={locale} />
        ) : (
          <div class="modal-actions">
            <button type="button" class="btn-primary" onClick={() => setShowUpgrade(true)}>
              Create an account and add this to my profile
            </button>
            <button type="button" class="btn-secondary" onClick={handleClose}>
              Continue editing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
