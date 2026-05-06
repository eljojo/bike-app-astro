CREATE TABLE `form_submissions` (
	`form_instance_id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`content_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `form_submissions_created_idx` ON `form_submissions` (`created_at`);
