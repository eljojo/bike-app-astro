-- Add `dismissed_at` to calendar_suggestion_dismissals so that an upstream
-- ICS update can invalidate a stale dismissal: if the source VEVENT's
-- LAST-MODIFIED is later than `dismissed_at`, the dismissal is treated as
-- no-longer-relevant and the suggestion re-surfaces.
--
-- Drop and recreate per existing convention in this table's history (no
-- backfill — preserving existing dismissal rows is a non-goal, and lacking a
-- timestamp on legacy rows would force a "treat as ancient" fallback that's
-- noisier than just letting users redismiss anything that genuinely should be
-- gone).
DROP TABLE `calendar_suggestion_dismissals`;--> statement-breakpoint
CREATE TABLE `calendar_suggestion_dismissals` (
	`city` text NOT NULL,
	`organizer_slug` text NOT NULL,
	`uid` text NOT NULL,
	`valid_until` text NOT NULL,
	`dismissed_at` text NOT NULL,
	PRIMARY KEY(`city`, `organizer_slug`, `uid`)
);--> statement-breakpoint
CREATE INDEX `csd_city_valid_until_idx` ON `calendar_suggestion_dismissals` (`city`, `valid_until`);
