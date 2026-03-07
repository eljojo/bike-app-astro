DROP INDEX IF EXISTS `users_username_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_idx` ON `users` (`username`);