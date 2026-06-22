CREATE TABLE `calendar_event_snapshots` (
	`city` text NOT NULL,
	`organizer_slug` text NOT NULL,
	`uid` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`snapshotted_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`city`, `organizer_slug`, `uid`)
);
--> statement-breakpoint
CREATE INDEX `ces_city_expires_idx` ON `calendar_event_snapshots` (`city`,`expires_at`);
