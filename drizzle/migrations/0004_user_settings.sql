CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`email_in_commits` integer DEFAULT false NOT NULL,
	`analytics_opt_out` integer DEFAULT false NOT NULL
);
