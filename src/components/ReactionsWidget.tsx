import { useState, useEffect, useCallback, useRef } from 'preact/hooks';

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
}

interface ReactionCounts {
  [key: string]: number;
}

const PENDING_KEY = 'pending_reaction';

function storePendingReaction(contentType: string, contentSlug: string, reactionType: string) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ contentType, contentSlug, reactionType }));
  } catch { /* localStorage unavailable */ }
}

function consumePendingReaction(contentType: string, contentSlug: string): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (pending.contentType === contentType && pending.contentSlug === contentSlug) {
      localStorage.removeItem(PENDING_KEY);
      return pending.reactionType;
    }
  } catch { /* ignore */ }
  return null;
}

export default function ReactionsWidget({ contentType, contentSlug, labels }: Props) {
  const [counts, setCounts] = useState<ReactionCounts>({});
  const [userReactions, setUserReactions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [animating, setAnimating] = useState<string | null>(null);
  const pendingProcessed = useRef(false);

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

  const toggleReaction = useCallback(async (reactionType: string) => {
    const res = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, contentSlug, reactionType }),
    });

    if (res.status === 401) {
      storePendingReaction(contentType, contentSlug, reactionType);
      window.location.href = `/gate?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
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
  }, [contentType, contentSlug]);

  // After loading, check for a pending reaction (user just returned from gate)
  useEffect(() => {
    if (loading || pendingProcessed.current) return;
    pendingProcessed.current = true;
    const pending = consumePendingReaction(contentType, contentSlug);
    if (pending) {
      toggleReaction(pending);
    }
  }, [loading, contentType, contentSlug, toggleReaction]);

  if (loading) return null;

  return (
    <div class="reactions-widget">
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
            <span class={`reaction-icon ${isAnimating ? 'pop' : ''}`}>{icon}</span>
            <span class="reaction-label">{label}</span>
            {count > 0 && <span class="reaction-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
