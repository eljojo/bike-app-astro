import { useState, useRef, useEffect } from 'preact/hooks';
import { slugify } from '../../lib/slug';
import type { TourSummary } from '../../types/admin';

interface Props {
  tours: TourSummary[];
  value: string;
  onChange: (slug: string) => void;
}

export default function TourPicker({ tours, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTourName, setNewTourName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = tours.find(t => t.slug === value);
  const filtered = tours.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelect(slug: string) {
    onChange(slug);
    setOpen(false);
    setSearch('');
    setCreating(false);
  }

  function handleCreate() {
    if (!newTourName.trim()) return;
    const slug = slugify(newTourName);
    if (slug) {
      onChange(slug);
      setOpen(false);
      setCreating(false);
      setNewTourName('');
    }
  }

  return (
    <div class="form-field tour-picker" ref={ref}>
      <label>Tour</label>
      <button type="button" class="tour-picker--trigger" onClick={() => setOpen(!open)}>
        {selected ? selected.name : value ? value : 'No tour'}
        <span class="tour-picker--arrow">&#x25BE;</span>
      </button>

      {open && (
        <div class="tour-picker--dropdown">
          <input
            type="text"
            class="tour-picker--search"
            placeholder="Search tours..."
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            autoFocus
          />

          <div class="tour-picker--options">
            <button type="button" class="tour-picker--option" onClick={() => handleSelect('')}>
              No tour
            </button>

            {filtered.map(tour => (
              <button
                type="button"
                class={`tour-picker--option ${tour.slug === value ? 'tour-picker--option--selected' : ''}`}
                onClick={() => handleSelect(tour.slug)}
              >
                <span class="tour-picker--option-name">{tour.name}</span>
                <span class="tour-picker--option-meta">
                  {tour.ride_count} rides
                  {tour.start_date && ` \u00B7 ${tour.start_date}`}
                </span>
              </button>
            ))}

            {!creating ? (
              <button type="button" class="tour-picker--option tour-picker--create" onClick={() => setCreating(true)}>
                + Create new tour...
              </button>
            ) : (
              <div class="tour-picker--create-form">
                <input
                  type="text"
                  value={newTourName}
                  onInput={(e) => setNewTourName((e.target as HTMLInputElement).value)}
                  placeholder="Tour name"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
                />
                <button type="button" onClick={handleCreate}>Create</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
