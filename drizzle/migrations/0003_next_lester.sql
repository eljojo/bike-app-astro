CREATE TABLE `route_edits` (
	`slug` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`github_sha` text NOT NULL,
	`updated_at` text NOT NULL
);
