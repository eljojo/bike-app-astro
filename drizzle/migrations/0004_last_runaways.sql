CREATE TABLE `email_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_tokens_token_unique` ON `email_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `email_tokens_token_idx` ON `email_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `email_tokens_email_idx` ON `email_tokens` (`email`);
