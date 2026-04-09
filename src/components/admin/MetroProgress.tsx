export type StopState = 'completed' | 'current' | 'future';

export function getStopState(index: number, currentStop: number): StopState {
  if (index < currentStop) return 'completed';
  if (index === currentStop) return 'current';
  return 'future';
}

interface Props {
  stops: string[];
  currentStop: number;
  onStopClick?: (index: number) => void;
}

export default function MetroProgress({ stops, currentStop, onStopClick }: Props) {
  return (
    <nav class="metro-progress" aria-label="Progress">
      <ol class="metro-stops">
        {stops.map((label, i) => {
          const state = getStopState(i, currentStop);
          const clickable = state === 'completed' && onStopClick;
          return (
            <li key={label} class={`metro-stop metro-stop--${state}`}>
              <button
                type="button"
                class="metro-stop-dot"
                disabled={!clickable}
                onClick={() => clickable && onStopClick(i)}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={label}
              />
              <span class="metro-stop-label">{label}</span>
              {i < stops.length - 1 && (
                <span class={`metro-stop-line ${state !== 'future' ? 'metro-stop-line--filled' : ''}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
