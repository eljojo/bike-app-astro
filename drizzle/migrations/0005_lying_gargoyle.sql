CREATE TABLE `strava_tokens` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`athlete_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL
);
