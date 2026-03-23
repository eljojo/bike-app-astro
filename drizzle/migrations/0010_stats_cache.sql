CREATE TABLE `stats_cache` (
	`city` text NOT NULL,
	`cache_key` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`city`, `cache_key`)
);
