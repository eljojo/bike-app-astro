import { useState } from 'preact/hooks';

/** Track which wizard steps were skipped, for celebration page nudges. */
export function useWizardSkips() {
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);
  const [step, setStep] = useState(0);

  function skipStep(field: string, nextStep: number) {
    setSkippedSteps(prev => [...prev, field]);
    setStep(nextStep);
  }

  return { step, setStep, skippedSteps, skipStep };
}

/** Build the URL for the celebration page after a successful wizard save. */
export function buildCelebrateUrl(
  contentType: string,
  contentId: string,
  skippedSteps: string[],
): string {
  const qs = new URLSearchParams({
    first: 'true',
    ...(skippedSteps.length > 0 ? { skipped: skippedSteps.join(',') } : {}),
  });
  return `/admin/celebrate/${contentType}/${contentId}?${qs}`;
}
