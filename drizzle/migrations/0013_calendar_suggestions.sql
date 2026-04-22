CREATE TABLE `calendar_feed_cache` (
	`organizer_slug` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`events_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_suggestion_dismissals` (
	`city` text NOT NULL,
	`uid` text NOT NULL,
	`organizer_slug` text NOT NULL,
	`dismissed_at` text NOT NULL,
	`dismissed_by` text NOT NULL,
	`event_snapshot_json` text,
	PRIMARY KEY(`city`, `uid`)
);
--> statement-breakpoint
CREATE INDEX `csd_city_idx` ON `calendar_suggestion_dismissals` (`city`);