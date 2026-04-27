DROP TABLE `calendar_feed_cache`;--> statement-breakpoint
DROP INDEX `csd_city_idx`;--> statement-breakpoint
ALTER TABLE `calendar_suggestion_dismissals` DROP COLUMN `organizer_slug`;--> statement-breakpoint
ALTER TABLE `calendar_suggestion_dismissals` DROP COLUMN `dismissed_at`;--> statement-breakpoint
ALTER TABLE `calendar_suggestion_dismissals` DROP COLUMN `dismissed_by`;--> statement-breakpoint
ALTER TABLE `calendar_suggestion_dismissals` DROP COLUMN `event_snapshot_json`;