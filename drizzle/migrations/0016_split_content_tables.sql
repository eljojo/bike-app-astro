DROP TABLE IF EXISTS `content_page_metrics`;
--> statement-breakpoint
CREATE TABLE `content_daily_metrics` (
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
  `entry_visitors` integer NOT NULL DEFAULT 0,
  PRIMARY KEY(`city`, `content_type`, `content_slug`, `page_type`, `date`)
);
--> statement-breakpoint
CREATE INDEX `cdm_date_idx` ON `content_daily_metrics` (`city`,`date`);
--> statement-breakpoint
CREATE INDEX `cdm_type_date_idx` ON `content_daily_metrics` (`city`,`content_type`,`date`);
--> statement-breakpoint
CREATE TABLE `content_totals` (
  `city` text NOT NULL,
  `content_type` text NOT NULL,
  `content_slug` text NOT NULL,
  `page_type` text NOT NULL,
  `pageviews` integer NOT NULL DEFAULT 0,
  `visitor_days` integer NOT NULL DEFAULT 0,
  `visit_duration_s` real NOT NULL DEFAULT 0,
  `bounce_rate` real NOT NULL DEFAULT 0,
  `video_plays` integer NOT NULL DEFAULT 0,
  `synced_at` text NOT NULL,
  PRIMARY KEY(`city`, `content_type`, `content_slug`, `page_type`)
);
--> statement-breakpoint
DELETE FROM `content_engagement`;
--> statement-breakpoint
DELETE FROM `site_daily_metrics`;
--> statement-breakpoint
DELETE FROM `site_event_metrics`;
--> statement-breakpoint
DELETE FROM `stats_cache`;
