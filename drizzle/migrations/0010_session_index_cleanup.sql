ALTER TABLE `users` ADD COLUMN `email_verified` integer NOT NULL DEFAULT 1;--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `email_tokens_token_idx`;
