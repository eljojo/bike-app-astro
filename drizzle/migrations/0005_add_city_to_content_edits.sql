-- Add city column with default for existing rows
ALTER TABLE content_edits ADD COLUMN city TEXT NOT NULL DEFAULT 'ottawa';
--> statement-breakpoint
-- Recreate table with new primary key (SQLite can't ALTER PRIMARY KEY)
CREATE TABLE content_edits_new (
  city TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_slug TEXT NOT NULL,
  data TEXT NOT NULL,
  github_sha TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (city, content_type, content_slug)
);
--> statement-breakpoint
INSERT INTO content_edits_new SELECT city, content_type, content_slug, data, github_sha, updated_at FROM content_edits;
--> statement-breakpoint
DROP TABLE content_edits;
--> statement-breakpoint
ALTER TABLE content_edits_new RENAME TO content_edits;
