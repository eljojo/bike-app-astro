import { useState, useEffect } from 'preact/hooks';

interface Props {
  message: string;
}

export default function TrustReceipt({ message }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <span class="trust-receipt" role="status" aria-live="polite">
      {message}
    </span>
  );
}
