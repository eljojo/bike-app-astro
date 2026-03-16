import { useCallback } from 'preact/hooks';

interface ValidationRule {
  /** DOM element ID to focus on failure */
  field: string;
  /** Return true if validation fails */
  check: () => boolean;
  /** Error message to display */
  message: string;
}

/**
 * Declarative form validation. Runs rules in order, focuses the first
 * failing field's DOM element, and returns the error message.
 */
export function useFormValidation(rules: ValidationRule[]) {
  const validate = useCallback((): string | null => {
    for (const rule of rules) {
      if (rule.check()) {
        document.getElementById(rule.field)?.focus();
        return rule.message;
      }
    }
    return null;
  }, [rules]);

  return { validate };
}
