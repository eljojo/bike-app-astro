import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { fetchWithGuest } from '../lib/guest-fetch';
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
  totalRoutes?: number;
  riddenProgressText?: string;
  riddenCompleteText?: string;
}

interface ReactionCounts {
  [key: string]: number;
}

export default function ReactionsWidget({ contentType, contentSlug, labels, bookmarkHint, trustReceiptMessage, totalRoutes, riddenProgressText, riddenCompleteText }: Props) {
  const [counts, setCounts] = useState<ReactionCounts>({});
  const [userReactions, setUserReactions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [animating, setAnimating] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [riddenCount, setRiddenCount] = useState<number | null>(null);
  const hasShownReceipt = useRef(false);

  const fetchReactions = useCallback(async () => {
    try {
      const res = await fetch(`/api/reactions/${contentType}/${contentSlug}`);
      if (res.ok) {
        const data = await res.json();
        setCounts(data.counts || {});
        setUserReactions(data.userReactions || []);
        setRiddenCount(data.riddenCount ?? null);
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

  const toggleReaction = useCallback(async (reactionType: string) => {
    // Silent mode: if guest minting fails, no-op rather than redirecting to
    // /login — a reaction tap must never yank the reader off the page.
    const res = await fetchWithGuest('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, contentSlug, reactionType }),
    }, {
      onAuthFail: 'silent',
      // Show the trust receipt once, on first successful guest creation.
      onGuestCreated: () => {
        if (!hasShownReceipt.current) {
          hasShownReceipt.current = true;
          setShowReceipt(true);
        }
      },
    });
    if (!res) return; // guest minting failed — silent no-op

    if (res.ok) {
      const data = await res.json();
      if (data.action === 'added') {
        setCounts(prev => ({
          ...prev,
          [reactionType]: (prev[reactionType] || 0) + 1,
        }));
        setUserReactions(prev => [...prev, reactionType]);
        playAnimation(reactionType);
        // Re-fetch to get updated riddenCount from server
        if (reactionType === 'ridden') fetchReactions();
      } else {
        setCounts(prev => ({
          ...prev,
          [reactionType]: Math.max((prev[reactionType] || 0) - 1, 0),
        }));
        setUserReactions(prev => prev.filter(r => r !== reactionType));
        if (reactionType === 'ridden') setRiddenCount(null);
      }
    }
  }, [contentType, contentSlug, fetchReactions]);

  if (loading) return null;

  const riddenActive = userReactions.includes('ridden');
  const showRiddenProgress = riddenActive && riddenCount !== null && totalRoutes;
  const riddenHint = showRiddenProgress
    ? (riddenCount >= totalRoutes
        ? riddenCompleteText
        : riddenProgressText?.replace('{remaining}', String(totalRoutes - riddenCount)))
    : null;

  return (
    <div class="reactions-widget">
      <div class="reactions-buttons">
        {labels.map(({ type, icon, label, title }) => {
          const count = counts[type] || 0;
          const active = userReactions.includes(type);
          const isAnimating = animating === type;
          const showProgress = type === 'ridden' && active && riddenCount !== null && totalRoutes;
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
              {showProgress
                ? <span class="reaction-count">{riddenCount}/{totalRoutes}</span>
                : count > 0 && <span class="reaction-count">{count}</span>}
            </button>
          );
        })}
        {riddenHint
          ? <span class="reaction-hint">{riddenHint}</span>
          : bookmarkHint && <span class="reaction-hint">{bookmarkHint}</span>}
      </div>
      {showReceipt && trustReceiptMessage && (
        <TrustReceipt message={trustReceiptMessage} />
      )}
    </div>
  );
}
