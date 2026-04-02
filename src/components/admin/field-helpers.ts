/** Returns { value, onInput } for spreading onto <input>. */
export function bindText(
  value: string,
  setter: (v: string) => void,
): { value: string; onInput: (e: Event) => void } {
  return {
    value,
    onInput: (e: Event) => setter((e.target as HTMLInputElement).value),
  };
}

/** Returns { checked, onChange } for spreading onto <input type="checkbox">. */
export function bindCheckbox(
  checked: boolean,
  setter: (v: boolean) => void,
): { checked: boolean; onChange: (e: Event) => void } {
  return {
    checked,
    onChange: (e: Event) => setter((e.target as HTMLInputElement).checked),
  };
}

/** Returns { value, onInput } for spreading onto <textarea>. */
export function bindTextarea(
  value: string,
  setter: (v: string) => void,
): { value: string; onInput: (e: Event) => void } {
  return {
    value,
    onInput: (e: Event) => setter((e.target as HTMLTextAreaElement).value),
  };
}
