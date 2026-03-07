import { useState, useEffect } from 'preact/hooks';
import { onToast } from '../../lib/toast';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
}

let nextId = 0;

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return onToast(({ message, type }) => {
      const id = nextId++;
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div class="toast-container">
      {toasts.map(t => (
        <div
          key={t.id}
          class={`toast toast--${t.type}`}
          onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
