import type { ComponentChildren } from 'preact';
import MetroProgress from './MetroProgress';

interface Props {
  stops: string[];
  currentStep: number;
  onStepChange: (step: number) => void;
  children: ComponentChildren;
}

export default function WizardLayout({ stops, currentStep, onStepChange, children }: Props) {
  return (
    <div class="wizard-layout">
      {currentStep > 0 && (
        <MetroProgress
          stops={stops}
          currentStop={currentStep - 1}
          onStopClick={(stopIndex) => onStepChange(stopIndex + 1)}
        />
      )}
      <div class="wizard-step">
        {children}
      </div>
    </div>
  );
}

interface WizardNavProps {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  skipLabel?: string;
  onSkip?: () => void;
}

export function WizardNav({ onBack, onNext, nextLabel = 'Continue', nextDisabled, skipLabel, onSkip }: WizardNavProps) {
  return (
    <div class="wizard-nav">
      <div>
        {onBack && (
          <button type="button" class="btn-secondary" onClick={onBack}>Back</button>
        )}
      </div>
      <div class="wizard-nav-right">
        {skipLabel && onSkip && (
          <button type="button" class="btn-link wizard-nav-skip" onClick={onSkip}>{skipLabel}</button>
        )}
        <button type="button" class="btn-primary" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
