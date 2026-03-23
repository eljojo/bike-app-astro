-- One-off: clear analytics data after redirect fix + metric order fix.
DELETE FROM `content_page_metrics`;
--> statement-breakpoint
DELETE FROM `content_engagement`;
--> statement-breakpoint
DELETE FROM `site_daily_metrics`;
--> statement-breakpoint
DELETE FROM `stats_cache`;
