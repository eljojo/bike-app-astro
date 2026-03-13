CREATE TABLE `video_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`content_type` text NOT NULL,
	`content_slug` text NOT NULL,
	`job_id` text,
	`status` text DEFAULT 'uploading' NOT NULL,
	`width` integer,
	`height` integer,
	`duration` text,
	`orientation` text,
	`poster_key` text,
	`lat` real,
	`lng` real,
	`captured_at` text,
	`title` text,
	`handle` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_jobs_key_unique` ON `video_jobs` (`key`);