CREATE TABLE `upload_attempts` (
	`action` text NOT NULL,
	`identifier` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upload_attempts_lookup_idx` ON `upload_attempts` (`action`,`identifier`,`created_at`);