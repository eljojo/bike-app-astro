import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import TrustReceipt from './TrustReceipt';
import Icon from './Icon';

interface ReactionButton {
  type: string;
  icon: string;
  label: string;
  title?: string;
}

interface Props {
  contentType: 'route' | 'event';
  contentSlug: string;
  labels: ReactionButton[];
  bookmarkHint?: string;
  trustReceiptMessage?: string;
}

interface ReactionCounts {
  [key: string]: number;
}

export default function ReactionsWidget({ contentType, contentSlug, labels, bookmarkHint, trustReceiptMessage }: Props) {
  const [counts, setCounts] = useState<ReactionCounts>({});
  const [userReactions, setUserReactions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [animating, setAnimating] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const hasShownReceipt = useRef(false);

  const fetchReactions = useCallback(async () => {
    try {
      const res = await fetch(`/api/reactions/${contentType}/${contentSlug}`);
      if (res.ok) {
        const data = await res.json();
        setCounts(data.counts || {});
        setUserReactions(data.userReactions || []);
      }
    } catch {
      // Network error — fail silently
    } finally {
      setLoading(false);
    }
  }, [contentType, contentSlug]);

  useEffect(() => {
    fetchReactions();
  }, [fetchReactions]);

  const playAnimation = (reactionType: string) => {
    setAnimating(reactionType);
    setTimeout(() => setAnimating(null), 600);
  };

  const createSilentGuest = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const toggleReaction = useCallback(async (reactionType: string) => {
    let res = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, contentSlug, reactionType }),
    });

    // Silent guest creation on 401
    if (res.status === 401) {
      const created = await createSilentGuest();
      if (!created) return;

      // Retry the reaction with the new session cookie
      res = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, contentSlug, reactionType }),
      });

      // Show trust receipt on first silent guest creation
      if (res.ok && !hasShownReceipt.current) {
        hasShownReceipt.current = true;
        setShowReceipt(true);
      }
    }

    if (res.ok) {
      const data = await res.json();
      if (data.action === 'added') {
        setCounts(prev => ({
          ...prev,
          [reactionType]: (prev[reactionType] || 0) + 1,
        }));
        setUserReactions(prev => [...prev, reactionType]);
        playAnimation(reactionType);
      } else {
        setCounts(prev => ({
          ...prev,
          [reactionType]: Math.max((prev[reactionType] || 0) - 1, 0),
        }));
        setUserReactions(prev => prev.filter(r => r !== reactionType));
      }
    }
  }, [contentType, contentSlug, createSilentGuest]);

  if (loading) return null;

  return (
    <div class="reactions-widget">
      <div class="reactions-buttons">
        {labels.map(({ type, icon, label, title }) => {
          const count = counts[type] || 0;
          const active = userReactions.includes(type);
          const isAnimating = animating === type;
          return (
            <button
              key={type}
              type="button"
              class={`reaction-btn ${active ? 'active' : ''} ${isAnimating ? 'pop' : ''}`}
              onClick={() => toggleReaction(type)}
              title={title || label}
            >
              <Icon
                name={icon}
                weight={active ? 'fill' : 'regular'}
                size={20}
                class={`reaction-icon ${isAnimating ? 'pop' : ''}`}
              />
              <span class="reaction-label">{label}</span>
              {count > 0 && <span class="reaction-count">{count}</span>}
            </button>
          );
        })}
      </div>
      {showReceipt && trustReceiptMessage && (
        <TrustReceipt message={trustReceiptMessage} />
      )}
      {bookmarkHint && (
        <p class="reaction-hint">{bookmarkHint}</p>
      )}
    </div>
  );
}
