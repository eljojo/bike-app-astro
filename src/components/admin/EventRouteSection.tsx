// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// All styles in admin.scss.
import type { RouteOption } from '../../types/admin';

interface Props {
  routeOptions: RouteOption[];
  selectedRoutes: string[];
  onRoutesChange: (routes: string[]) => void;
}

export default function EventRouteSection({ routeOptions, selectedRoutes, onRoutesChange }: Props) {
  return (
    <section class="editor-section">
      <h2>Routes</h2>
      <div class="auth-form">
        {selectedRoutes.map((slug, i) => (
          <div class="route-selector-row" key={`route-${i}`}>
            <select value={slug}
              onChange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                onRoutesChange(selectedRoutes.map((s, j) => j === i ? val : s));
              }}>
              <option value="">-- Select route --</option>
              {routeOptions.map(r => (
                <option key={r.slug} value={r.slug}>{r.name}</option>
              ))}
            </select>
            <button type="button" class="btn-link btn-danger"
              onClick={() => onRoutesChange(selectedRoutes.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" class="btn-link"
          onClick={() => onRoutesChange([...selectedRoutes, ''])}>
          Add route
        </button>
      </div>
    </section>
  );
}
