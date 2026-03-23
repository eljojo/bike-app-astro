-- Add gpx_downloads to content tables, rename avg_visit_duration to total_duration_s
ALTER TABLE `content_daily_metrics` ADD COLUMN `gpx_downloads` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `content_totals` ADD COLUMN `gpx_downloads` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP TABLE IF EXISTS `site_daily_metrics`;
--> statement-breakpoint
CREATE TABLE `site_daily_metrics` (
  `city` text NOT NULL,
  `date` text NOT NULL,
  `total_pageviews` integer NOT NULL DEFAULT 0,
  `unique_visitors` integer NOT NULL DEFAULT 0,
  `total_duration_s` real NOT NULL DEFAULT 0,
  PRIMARY KEY(`city`, `date`)
);
--> statement-breakpoint
DELETE FROM `content_daily_metrics`;
--> statement-breakpoint
DELETE FROM `content_totals`;
--> statement-breakpoint
DELETE FROM `content_engagement`;
--> statement-breakpoint
DELETE FROM `site_event_metrics`;
--> statement-breakpoint
DELETE FROM `stats_cache`;
