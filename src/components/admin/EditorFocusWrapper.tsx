import type { ComponentChildren } from 'preact';

interface Props {
  focused: boolean; // true = this section is the focused one
  focusActive: boolean; // true = some focus mode is active
  children: ComponentChildren;
}

/**
 * Wraps an editor section for focus mode. When focus is active and this
 * section is NOT focused, it's hidden via display:none so form state is
 * preserved. "Show all fields" expands everything.
 */
export default function EditorFocusWrapper({ focused, focusActive, children }: Props) {
  if (!focusActive || focused) {
    return <>{children}</>;
  }

  // Not focused — hidden but rendered for form state
  return (
    <div class="focus-collapsed" style="display: none;">
      {children}
    </div>
  );
}

interface FocusHeaderProps {
  focusSection: string | null;
  labels: Record<string, string>; // focusSection → pre-interpolated label
  showAllLabel: string;
  onExpand: () => void;
}

export function FocusHeader({ focusSection, labels, showAllLabel, onExpand }: FocusHeaderProps) {
  if (!focusSection) return null;

  return (
    <div class="focus-header">
      <p class="focus-header-label">{labels[focusSection] || ''}</p>
      <button type="button" class="btn-secondary focus-expand-btn" onClick={onExpand}>
        {showAllLabel}
      </button>
    </div>
  );
}
