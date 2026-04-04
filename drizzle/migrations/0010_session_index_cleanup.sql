CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `email_tokens_token_idx`;
