type ToastType = 'success' | 'error';

interface ToastEvent {
  message: string;
  type: ToastType;
}

const listeners = new Set<(event: ToastEvent) => void>();

export function showToast(message: string, type: ToastType = 'success') {
  for (const listener of listeners) {
    listener({ message, type });
  }
}

export function onToast(callback: (event: ToastEvent) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
