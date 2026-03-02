PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_credentials` (
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
INSERT INTO `__new_credentials`("id", "user_id", "credential_id", "public_key", "counter", "transports", "created_at") SELECT "id", "user_id", "credential_id", "public_key", "counter", "transports", "created_at" FROM `credentials`;--> statement-breakpoint
DROP TABLE `credentials`;--> statement-breakpoint
ALTER TABLE `__new_credentials` RENAME TO `credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_credential_id_unique` ON `credentials` (`credential_id`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "user_id", "token", "expires_at", "created_at") SELECT "id", "user_id", "token", "expires_at", "created_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);