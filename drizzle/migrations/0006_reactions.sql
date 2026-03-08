CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`user_id` text NOT NULL,
	`content_type` text NOT NULL,
	`content_slug` text NOT NULL,
	`reaction_type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reactions_content_idx` ON `reactions` (`city`,`content_type`,`content_slug`);
--> statement-breakpoint
CREATE INDEX `reactions_user_idx` ON `reactions` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_unique_idx` ON `reactions` (`city`,`user_id`,`content_type`,`content_slug`,`reaction_type`);
