// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// All styles in admin.scss.
import { useDragReorder } from '../../lib/hooks';
import type { EventWaypoint } from '../../lib/models/event-model';

export type Waypoint = EventWaypoint;

interface PlaceOption {
  id: string;
  name: string;
}

interface Props {
  waypoints: Waypoint[];
  onChange: (waypoints: Waypoint[]) => void;
  places: PlaceOption[];
  routes?: string[];
}

const WAYPOINT_TYPES: Array<{ value: Waypoint['type']; label: string }> = [
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'danger', label: 'Danger' },
  { value: 'poi', label: 'Point of interest' },
];

export default function WaypointEditor({ waypoints, onChange, places, routes }: Props) {
  const drag = useDragReorder(waypoints, onChange);

  function updateWaypoint(index: number, patch: Partial<Waypoint>) {
    onChange(waypoints.map((w, i) => i === index ? { ...w, ...patch } : w));
  }

  function addWaypoint() {
    onChange([...waypoints, { place: '', type: 'checkpoint', label: '' }]);
  }

  function removeWaypoint(index: number) {
    onChange(waypoints.filter((_, i) => i !== index));
  }

  return (
    <div class="waypoint-editor">
      {waypoints.map((wp, i) => (
        <div
          key={`wp-${i}`}
          class={`waypoint-row ${drag.dragIdx === i ? 'dragging' : ''}`}
          draggable
          onDragStart={() => drag.handleDragStart(i)}
          onDragOver={(e: DragEvent) => drag.handleDragOver(e, i)}
          onDragEnd={drag.handleDragEnd}
        >
          <span class="drag-handle">⠿</span>

          <div class="waypoint-fields">
            <div class="waypoint-main-row">
              <select value={wp.place}
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  const place = places.find(p => p.id === val);
                  updateWaypoint(i, { place: val, label: wp.label || place?.name || '' });
                }}>
                <option value="">-- Select place --</option>
                {places.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <select value={wp.type}
                onChange={(e) => updateWaypoint(i, { type: (e.target as HTMLSelectElement).value as Waypoint['type'] })}>
                {WAYPOINT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>

              <button type="button" class="btn-link btn-danger" onClick={() => removeWaypoint(i)}>
                Remove
              </button>
            </div>

            <div class="waypoint-detail-row">
              <input type="text" value={wp.label} placeholder="Label"
                onInput={(e) => updateWaypoint(i, { label: (e.target as HTMLInputElement).value })} />
              <input type="number" value={wp.distance_km ?? ''} placeholder="km" step="0.1"
                class="waypoint-distance"
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  updateWaypoint(i, { distance_km: val ? parseFloat(val) : undefined });
                }} />
            </div>

            {wp.type === 'checkpoint' && (
              <div class="waypoint-detail-row">
                <input type="time" value={wp.opening || ''} placeholder="Opening"
                  onInput={(e) => updateWaypoint(i, { opening: (e.target as HTMLInputElement).value || undefined })} />
                <input type="time" value={wp.closing || ''} placeholder="Closing"
                  onInput={(e) => updateWaypoint(i, { closing: (e.target as HTMLInputElement).value || undefined })} />
                <span class="waypoint-time-labels">opening / closing</span>
              </div>
            )}

            {routes && routes.length > 1 && (
              <div class="waypoint-detail-row">
                <select value={wp.route || ''}
                  onChange={(e) => updateWaypoint(i, { route: (e.target as HTMLSelectElement).value || undefined })}>
                  <option value="">All routes</option>
                  {routes.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}

            <div class="waypoint-detail-row">
              <input type="text" value={wp.note || ''} placeholder="Note (e.g. fill bottles here)"
                class="waypoint-note"
                onInput={(e) => updateWaypoint(i, { note: (e.target as HTMLInputElement).value || undefined })} />
            </div>
          </div>
        </div>
      ))}

      <button type="button" class="btn-link" onClick={addWaypoint}>
        Add waypoint
      </button>
    </div>
  );
}
