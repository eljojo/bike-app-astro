-- One-off: clear all analytics data so it gets re-synced with correct metric mapping.
-- Safe to run: all analytics tables are reconstructable caches.
DELETE FROM `content_page_metrics`;
--> statement-breakpoint
DELETE FROM `content_engagement`;
--> statement-breakpoint
DELETE FROM `site_daily_metrics`;
--> statement-breakpoint
DELETE FROM `stats_cache`;
