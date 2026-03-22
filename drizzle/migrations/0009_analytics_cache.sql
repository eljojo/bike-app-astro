CREATE TABLE `content_page_metrics` (
	`city` text NOT NULL,
	`content_type` text NOT NULL,
	`content_slug` text NOT NULL,
	`page_type` text NOT NULL,
	`date` text NOT NULL,
	`pageviews` integer NOT NULL DEFAULT 0,
	`visitor_days` integer NOT NULL DEFAULT 0,
	`visit_duration_s` real NOT NULL DEFAULT 0,
	`bounce_rate` real NOT NULL DEFAULT 0,
	`video_plays` integer NOT NULL DEFAULT 0,
	PRIMARY KEY(`city`, `content_type`, `content_slug`, `page_type`, `date`)
);
--> statement-breakpoint
CREATE TABLE `content_engagement` (
	`city` text NOT NULL,
	`content_type` text NOT NULL,
	`content_slug` text NOT NULL,
	`total_pageviews` integer NOT NULL DEFAULT 0,
	`total_visitor_days` integer NOT NULL DEFAULT 0,
	`avg_visit_duration` real NOT NULL DEFAULT 0,
	`avg_bounce_rate` real NOT NULL DEFAULT 0,
	`stars` integer NOT NULL DEFAULT 0,
	`video_play_rate` real NOT NULL DEFAULT 0,
	`map_conversion_rate` real NOT NULL DEFAULT 0,
	`wall_time_hours` real NOT NULL DEFAULT 0,
	`engagement_score` real NOT NULL DEFAULT 0,
	`last_synced_at` text NOT NULL,
	PRIMARY KEY(`city`, `content_type`, `content_slug`)
);
--> statement-breakpoint
CREATE TABLE `site_daily_metrics` (
	`city` text NOT NULL,
	`date` text NOT NULL,
	`total_pageviews` integer NOT NULL DEFAULT 0,
	`unique_visitors` integer NOT NULL DEFAULT 0,
	`new_accounts` integer NOT NULL DEFAULT 0,
	`reactions_count` integer NOT NULL DEFAULT 0,
	`active_users` integer NOT NULL DEFAULT 0,
	PRIMARY KEY(`city`, `date`)
);
--> statement-breakpoint
CREATE INDEX `cpm_date_idx` ON `content_page_metrics` (`city`,`date`);
--> statement-breakpoint
CREATE INDEX `cpm_type_date_idx` ON `content_page_metrics` (`city`,`content_type`,`date`);
--> statement-breakpoint
CREATE INDEX `ce_type_pageviews_idx` ON `content_engagement` (`city`,`content_type`,`total_pageviews`);
--> statement-breakpoint
CREATE INDEX `ce_type_duration_idx` ON `content_engagement` (`city`,`content_type`,`avg_visit_duration`);
--> statement-breakpoint
CREATE INDEX `ce_type_engagement_idx` ON `content_engagement` (`city`,`content_type`,`engagement_score`);
--> statement-breakpoint
CREATE INDEX `ce_type_walltime_idx` ON `content_engagement` (`city`,`content_type`,`wall_time_hours`);
--> statement-breakpoint
CREATE INDEX `reactions_city_created_idx` ON `reactions` (`city`,`created_at`);
--> statement-breakpoint
CREATE INDEX `reactions_city_type_created_idx` ON `reactions` (`city`,`content_type`,`reaction_type`,`created_at`);
--> statement-breakpoint
CREATE INDEX `users_created_at_idx` ON `users` (`created_at`);
