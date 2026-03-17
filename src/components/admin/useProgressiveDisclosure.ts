import { useState, useCallback } from 'preact/hooks';

/**
 * Manage progressive disclosure state for optional form fields.
 * Each field starts open or closed based on the initial map,
 * and can be opened or toggled by user interaction.
 */
export function useProgressiveDisclosure<K extends string>(
  initialState: Record<K, boolean>,
) {
  const [state, setState] = useState(initialState);

  const isOpen = useCallback((key: K): boolean => state[key], [state]);

  const open = useCallback((key: K): void => {
    setState(prev => ({ ...prev, [key]: true }));
  }, []);

  const close = useCallback((key: K): void => {
    setState(prev => ({ ...prev, [key]: false }));
  }, []);

  const toggle = useCallback((key: K): void => {
    setState(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { isOpen, open, close, toggle };
}
