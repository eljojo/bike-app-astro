CREATE TABLE `banned_ips` (
	`ip` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`banned_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `content_edits` (
	`city` text NOT NULL,
	`content_type` text NOT NULL,
	`content_slug` text NOT NULL,
	`data` text NOT NULL,
	`github_sha` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`city`, `content_type`, `content_slug`)
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` blob NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_credential_id_unique` ON `credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `credentials_user_id_idx` ON `credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`username` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`created_at` text NOT NULL,
	`banned_at` text,
	`ip_address` text,
	`previous_usernames` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);