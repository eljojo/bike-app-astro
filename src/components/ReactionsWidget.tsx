import { useState, useEffect, useCallback } from 'preact/hooks';

interface ReactionButton {
  type: string;
  icon: string;
  label: string;
}

interface Props {
  contentType: 'route' | 'event';
  contentSlug: string;
  labels: ReactionButton[];
}

interface ReactionCounts {
  [key: string]: number;
}

export default function ReactionsWidget({ contentType, contentSlug, labels }: Props) {
  const [counts, setCounts] = useState<ReactionCounts>({});
  const [userReactions, setUserReactions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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

  const toggleReaction = async (reactionType: string) => {
    const res = await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, contentSlug, reactionType }),
    });

    if (res.status === 401) {
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
      } else {
        setCounts(prev => ({
          ...prev,
          [reactionType]: Math.max((prev[reactionType] || 0) - 1, 0),
        }));
        setUserReactions(prev => prev.filter(r => r !== reactionType));
      }
    }
  };

  if (loading) return null;

  return (
    <div class="reactions-widget">
      {labels.map(({ type, icon, label }) => {
        const count = counts[type] || 0;
        const active = userReactions.includes(type);
        return (
          <button
            key={type}
            type="button"
            class={`reaction-btn ${active ? 'active' : ''}`}
            onClick={() => toggleReaction(type)}
            title={label}
          >
            <span class="reaction-icon">{icon}</span>
            <span class="reaction-label">{label}</span>
            {count > 0 && <span class="reaction-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
