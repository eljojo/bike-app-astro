-- Drop poster_key column from video_jobs (poster URL is derived from video key)
-- SQLite doesn't support DROP COLUMN, so recreate the table
CREATE TABLE `video_jobs_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`content_kind` text NOT NULL,
	`content_slug` text NOT NULL,
	`job_id` text,
	`status` text DEFAULT 'uploading' NOT NULL,
	`width` integer,
	`height` integer,
	`duration` text,
	`orientation` text,
	`lat` real,
	`lng` real,
	`captured_at` text,
	`title` text,
	`handle` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `video_jobs_new` SELECT `id`, `key`, `content_kind`, `content_slug`, `job_id`, `status`, `width`, `height`, `duration`, `orientation`, `lat`, `lng`, `captured_at`, `title`, `handle`, `created_at`, `updated_at` FROM `video_jobs`;
--> statement-breakpoint
DROP TABLE `video_jobs`;
--> statement-breakpoint
ALTER TABLE `video_jobs_new` RENAME TO `video_jobs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `video_jobs_key_unique` ON `video_jobs` (`key`);
