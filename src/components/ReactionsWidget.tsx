import { useState, useEffect, useCallback } from 'preact/hooks';

interface Props {
  contentType: 'route' | 'event';
  contentSlug: string;
}

interface ReactionCounts {
  ridden?: number;
  'thumbs-up'?: number;
  star?: number;
}

const BUTTONS = [
  { type: 'ridden', icon: '\u{1F6B4}', label: "I've ridden this" },
  { type: 'thumbs-up', icon: '\u{1F44D}', label: 'Great route' },
  { type: 'star', icon: '\u2B50', label: 'Star' },
] as const;

export default function ReactionsWidget({ contentType, contentSlug }: Props) {
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
          [reactionType]: (prev[reactionType as keyof ReactionCounts] || 0) + 1,
        }));
        setUserReactions(prev => [...prev, reactionType]);
      } else {
        setCounts(prev => ({
          ...prev,
          [reactionType]: Math.max((prev[reactionType as keyof ReactionCounts] || 0) - 1, 0),
        }));
        setUserReactions(prev => prev.filter(r => r !== reactionType));
      }
    }
  };

  if (loading) return null;

  return (
    <div class="reactions-widget">
      {BUTTONS.map(({ type, icon, label }) => {
        const count = counts[type as keyof ReactionCounts] || 0;
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
