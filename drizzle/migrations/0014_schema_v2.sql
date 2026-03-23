-- Drop and recreate site_daily_metrics without unused columns
DROP TABLE IF EXISTS `site_daily_metrics`;
--> statement-breakpoint
CREATE TABLE `site_daily_metrics` (
  `city` text NOT NULL,
  `date` text NOT NULL,
  `total_pageviews` integer NOT NULL DEFAULT 0,
  `unique_visitors` integer NOT NULL DEFAULT 0,
  `avg_visit_duration` real NOT NULL DEFAULT 0,
  PRIMARY KEY(`city`, `date`)
);
--> statement-breakpoint
ALTER TABLE `content_page_metrics` ADD COLUMN `entry_visitors` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `site_event_metrics` (
  `city` text NOT NULL,
  `event_name` text NOT NULL,
  `date` text NOT NULL,
  `dimension_value` text NOT NULL,
  `visitors` integer NOT NULL DEFAULT 0,
  PRIMARY KEY(`city`, `event_name`, `date`, `dimension_value`)
);
--> statement-breakpoint
DELETE FROM `content_page_metrics`;
--> statement-breakpoint
DELETE FROM `content_engagement`;
--> statement-breakpoint
DELETE FROM `stats_cache`;
