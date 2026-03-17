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
  routeName: string;
  labels: Record<string, string>; // focusSection → label
  showAllLabel: string;
  onExpand: () => void;
}

export function FocusHeader({ focusSection, routeName, labels, showAllLabel, onExpand }: FocusHeaderProps) {
  if (!focusSection) return null;

  const label = labels[focusSection] || '';
  const rendered = label.replace('{name}', routeName);

  return (
    <div class="focus-header">
      <p class="focus-header-label">{rendered}</p>
      <button type="button" class="btn-secondary focus-expand-btn" onClick={onExpand}>
        {showAllLabel}
      </button>
    </div>
  );
}
