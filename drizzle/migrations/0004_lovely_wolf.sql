CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_type` text NOT NULL,
	`content_slug` text NOT NULL,
	`branch_name` text NOT NULL,
	`pr_number` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `content_edits` (
	`content_type` text NOT NULL,
	`content_slug` text NOT NULL,
	`data` text NOT NULL,
	`github_sha` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`content_type`, `content_slug`)
);
--> statement-breakpoint
DROP TABLE `route_edits`;
--> statement-breakpoint
DROP TABLE `invite_codes`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "display_name", "role", "created_at") SELECT "id", "email", "display_name", "role", "created_at" FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
