import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useHydrated } from '../../lib/hooks';
import { launchConfetti } from './confetti';
import InlineUpgradeForm from './InlineUpgradeForm';

interface Props {
  contentType: string;
  contentId: string;
  contentName: string;
  cityName: string;
  publicUrl: string;
  isFirst?: boolean;
  isGuest?: boolean;
  skipped?: string[];
}

type Phase = 'waiting' | 'deploying' | 'live';

export default function CelebrationIsland({
  contentType, contentId, contentName, cityName, publicUrl, isFirst, isGuest, skipped = [],
}: Props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [phase, setPhase] = useState<Phase>('waiting');
  const [progress, setProgress] = useState(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState(0);
  const [copied, setCopied] = useState(false);
  const confettiFired = useRef(false);
  const sawActivity = useRef(false);
  const abortRef = useRef(false);

  const pollDeploy = useCallback(async () => {
    if (abortRef.current) return;
    try {
      const res = await fetch('/api/admin/deploy-status');
      if (!res.ok) { if (!abortRef.current) setTimeout(pollDeploy, 10_000); return; }
      const data = await res.json();

      if (data.status === 'deploying') {
        sawActivity.current = true;
        setPhase('deploying');
        setProgress(data.progress || 0);
        setEstimatedMinutes(data.estimatedMinutes || 0);
        if (!abortRef.current) setTimeout(pollDeploy, 5_000);
        return;
      }

      if (data.status === 'queued') {
        sawActivity.current = true;
        setPhase('waiting');
        if (!abortRef.current) setTimeout(pollDeploy, 5_000);
        return;
      }

      // status === 'idle'
      if (sawActivity.current) {
        setPhase('live');
        return;
      }

      if (!abortRef.current) setTimeout(pollDeploy, 10_000);
    } catch {
      if (!abortRef.current) setTimeout(pollDeploy, 15_000);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(pollDeploy, 2_000);
    const fallback = setTimeout(() => { if (phase !== 'live') setPhase('live'); }, 8 * 60_000);
    return () => { abortRef.current = true; clearTimeout(timer); clearTimeout(fallback); };
  }, [pollDeploy]);

  useEffect(() => {
    if (phase === 'live' && isFirst && !confettiFired.current) {
      confettiFired.current = true;
      launchConfetti(document.body);
    }
  }, [phase, isFirst]);

  function copyLink() {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const adminEditUrl = contentType === 'event'
    ? `/admin/events/${contentId}`
    : `/admin/${contentType}s/${contentId}`;
  const supportsFocusMode = contentType === 'route' || contentType === 'event';

  if (phase === 'waiting') {
    return (
      <div ref={hydratedRef} class="celebration">
        <div class="celebration-waiting">
          <div class="celebration-pulse" />
          <h1 class="celebration-heading">Your {contentType} is on its way</h1>
          <p class="celebration-message">
            You just made it easier for someone to discover {contentName}.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'deploying') {
    return (
      <div ref={hydratedRef} class="celebration">
        <div class="celebration-waiting">
          <div class="celebration-pulse" />
          <h1 class="celebration-heading">Your {contentType} is on its way</h1>
          <p class="celebration-message">
            You just made it easier for someone to discover {contentName}.
          </p>
          <div class="celebration-progress">
            <div class="celebration-progress-track">
              <div class="celebration-progress-fill" style={`width: ${progress}%`} />
            </div>
            <span class="celebration-progress-text">About {estimatedMinutes} minute{estimatedMinutes !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={hydratedRef} class="celebration">
      <div class="celebration-live">
        <h1 class="celebration-live-heading">{contentName} is live!</h1>
        <p class="celebration-message">Anyone in {cityName} can find it now.</p>
        <a href={publicUrl} class="celebration-link" target="_blank" rel="noopener">{publicUrl}</a>
        <div class="celebration-share">
          <button type="button" class="btn-primary" onClick={copyLink}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a href={publicUrl} class="btn-secondary" target="_blank" rel="noopener" style="text-decoration: none;">View live</a>
        </div>
      </div>

      {isGuest && (
        <div class="celebration-upgrade">
          <p>Want this on your profile? Create an account and this {contentType} is yours.</p>
          <InlineUpgradeForm />
        </div>
      )}

      {skipped.length > 0 && (
        <div class="celebration-nudges">
          <h3>What's next</h3>
          <ul>
            {skipped.includes('body') && <li><a href={supportsFocusMode ? `${adminEditUrl}?focus=description` : adminEditUrl}>Add a description</a> — it helps people decide</li>}
            {skipped.includes('media') && <li><a href={supportsFocusMode ? `${adminEditUrl}?focus=media` : adminEditUrl}>Add photos to make it stand out</a></li>}
          </ul>
        </div>
      )}

      <div class="celebration-nudges">
        <ul>
          <li><a href={`/admin/${contentType}s`}>Back to {contentType}s</a></li>
          <li><a href={`/admin/${contentType}s/new`}>Add another {contentType}</a></li>
        </ul>
      </div>
    </div>
  );
}
