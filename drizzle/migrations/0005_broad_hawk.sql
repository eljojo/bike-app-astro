CREATE INDEX `credentials_user_id_idx` ON `credentials` (`user_id`);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `drafts_user_content_idx` ON `drafts` (`user_id`, `content_type`, `content_slug`);
