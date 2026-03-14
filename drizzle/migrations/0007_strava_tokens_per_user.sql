-- Migrate strava_tokens from single-row (id=1) to per-user (keyed by user_id)
DROP TABLE IF EXISTS `strava_tokens`;
--> statement-breakpoint
CREATE TABLE `strava_tokens` (
	`user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`athlete_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL
);
