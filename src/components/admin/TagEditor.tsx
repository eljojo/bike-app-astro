// Shared tag editor component. Used by RouteEditor, EventEditor, CommunityEditor, BikePathEditor.
import { useState } from 'preact/hooks';

interface Props {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  knownTags?: string[];
  tagTranslations?: Record<string, Record<string, string>>;
  /** The locale currently active in the editor. Affects pill display and datalist suggestions. */
  activeLocale?: string;
  /**
   * The site's default locale. When provided and activeLocale differs from it,
   * the datalist only shows suggestions for activeLocale (not all locales).
   * When omitted or equal to activeLocale, all translated variants are offered.
   */
  defaultLocale?: string;
  placeholder?: string;
  datalistId: string;
}

export default function TagEditor({
  tags,
  onTagsChange,
  knownTags = [],
  tagTranslations = {},
  activeLocale = '',
  defaultLocale = '',
  placeholder = 'Add tag...',
  datalistId,
}: Props) {
  const [tagInput, setTagInput] = useState('');

  function displayTag(tag: string): string {
    if (!activeLocale) return tag;
    return tagTranslations[tag]?.[activeLocale] ?? tag;
  }

  function resolveTag(input: string): string {
    if (knownTags.includes(input)) return input;
    for (const [key, locales] of Object.entries(tagTranslations)) {
      for (const translated of Object.values(locales)) {
        if (translated.toLowerCase() === input) return key;
      }
    }
    return input;
  }

  function addTag() {
    const raw = tagInput.trim().toLowerCase();
    if (!raw) { setTagInput(''); return; }
    const tag = resolveTag(raw);
    if (!tags.includes(tag)) {
      onTagsChange([...tags, tag]);
    }
    setTagInput('');
  }

  function removeTag(tag: string) {
    onTagsChange(tags.filter(t => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  }

  // In non-default locale, only offer that locale's translations.
  // In default locale (or when no defaultLocale provided), offer all translated variants.
  const isNonDefaultLocale = activeLocale && defaultLocale && activeLocale !== defaultLocale;

  return (
    <div class="tag-editor">
      {tags.map(tag => (
        <span key={tag} class="tag-pill">
          {displayTag(tag)}
          <button type="button" onClick={() => removeTag(tag)}>{'×'}</button>
        </span>
      ))}
      <input
        type="text"
        class="tag-input"
        list={datalistId}
        value={tagInput}
        onInput={e => setTagInput((e.target as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={placeholder}
      />
      <datalist id={datalistId}>
        {knownTags
          .filter(t => !tags.includes(t))
          .flatMap(tag => {
            const options = [<option key={tag} value={tag} />];
            const locales = tagTranslations[tag];
            if (locales) {
              if (isNonDefaultLocale) {
                // Only offer the active locale's translation
                const translated = locales[activeLocale];
                if (translated) {
                  options.push(<option key={`${tag}-${activeLocale}`} value={translated} />);
                }
              } else {
                // Offer all locale translations
                for (const [locale, translated] of Object.entries(locales)) {
                  options.push(<option key={`${tag}-${locale}`} value={translated} />);
                }
              }
            }
            return options;
          })}
      </datalist>
    </div>
  );
}
