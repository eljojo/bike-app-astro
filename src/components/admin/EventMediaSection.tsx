// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// All styles in admin.scss.
import MediaManager from './MediaManager';
import type { MediaItem } from './MediaManager';

interface Props {
  media: MediaItem[];
  onMediaChange: (media: MediaItem[]) => void;
  cdnUrl: string;
  userRole?: string;
}

export default function EventMediaSection({ media, onMediaChange, cdnUrl, userRole }: Props) {
  return (
    <section class="editor-section">
      <h2>Photos</h2>
      <MediaManager
        media={media}
        onChange={onMediaChange}
        cdnUrl={cdnUrl}
        userRole={userRole}
      />
    </section>
  );
}
