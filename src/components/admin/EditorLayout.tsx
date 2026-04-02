import type { ComponentChildren } from 'preact';
import EditorActions from './EditorActions';
import type { UseEditorFormResult } from './useEditorForm';

interface EditorLayoutProps {
  /** Result from useEditorForm */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic ref type varies per editor
  editor: UseEditorFormResult<any>;
  /** CSS class for root element, e.g. "bike-path-editor" */
  className: string;
  /** Content type label for EditorActions, e.g. "bike path" */
  contentType: string;
  /** User role */
  userRole?: string;
  /** Guest label text */
  guestLabel?: string;
  /** View link for EditorActions */
  viewLink: string;
  /** Show license notice (default true) */
  showLicenseNotice?: boolean;
  /** Read-only mode (EventEditor uses fieldset disabled) */
  disabled?: boolean;
  /** Root element — 'div' (default) or 'fieldset' (EventEditor) */
  as?: 'div' | 'fieldset';
  /** Hide tab buttons (RouteEditor focus mode) */
  hideTabs?: boolean;
  /** Edit pane content */
  children: ComponentChildren;
  /** Preview pane content */
  preview: ComponentChildren;
  /** Content before tabs (drag overlay, focus header, etc.) */
  beforeTabs?: ComponentChildren;
  /** Content after the auth-form div but before EditorActions (extra editor sections) */
  afterForm?: ComponentChildren;
}

export default function EditorLayout({
  editor, className, contentType, userRole, guestLabel, viewLink,
  showLicenseNotice, disabled, as: Tag = 'div', hideTabs,
  children, preview, beforeTabs, afterForm,
}: EditorLayoutProps) {
  return (
    <Tag class={className} ref={editor.hydratedRef} disabled={disabled}>
      {beforeTabs}
      {userRole === 'guest' && guestLabel && (
        <p class="editor-guest-label">{guestLabel}</p>
      )}
      <div class={`route-editor-tabs${hideTabs ? ' route-editor-tabs--hidden' : ''}`}>
        <button
          type="button"
          class={`route-editor-tab ${editor.activeTab === 'edit' ? 'route-editor-tab--active' : ''}`}
          onClick={() => editor.setActiveTab('edit')}
        >Edit</button>
        <button
          type="button"
          class={`route-editor-tab ${editor.activeTab === 'preview' ? 'route-editor-tab--active' : ''}`}
          onClick={() => editor.setActiveTab('preview')}
        >Preview</button>
      </div>
      <div class="route-editor-panes">
        <div class={`route-editor-edit ${editor.activeTab !== 'edit' ? 'route-editor-pane--hidden' : ''}`}>
          <div class="auth-form">
            {children}
          </div>
          {afterForm}
          <EditorActions
            error={editor.error}
            githubUrl={editor.githubUrl}
            saved={editor.saved}
            saving={editor.saving}
            onSave={editor.save}
            onDismiss={editor.dismissSaved}
            contentType={contentType}
            userRole={userRole}
            guestCreated={editor.guestCreated}
            viewLink={viewLink}
            showLicenseNotice={showLicenseNotice}
            licenseDocsUrl="https://whereto.bike/about/licensing/"
            disabled={disabled}
          />
        </div>
        <div class={`route-editor-preview ${editor.activeTab !== 'preview' ? 'route-editor-pane--hidden' : ''}`}>
          {preview}
        </div>
      </div>
    </Tag>
  );
}
