-- Replace the dismissals query strategy: instead of `WHERE city = ? AND uid IN
-- (?, ...)` (which blew through D1's 100-bind-parameter cap once a feed like
-- OBC's added 90+ candidates in one pageload), each row carries a `valid_until`
-- date and the read becomes `WHERE city = ? AND valid_until >= ?`.
--
-- For one-offs `valid_until` is the event's start date; for recurrence series
-- it's the season_end; for unbounded series we use a far-future sentinel.
-- Past dismissals fall out of the predicate naturally — no per-request cost,
-- and a future cleanup job can prune them whenever it matters.
--
-- Drop and recreate (no backfill — the prior shape only shipped briefly and
-- preserving stale dismissals is a non-goal).
DROP TABLE `calendar_suggestion_dismissals`;--> statement-breakpoint
CREATE TABLE `calendar_suggestion_dismissals` (
	`city` text NOT NULL,
	`organizer_slug` text NOT NULL,
	`uid` text NOT NULL,
	`valid_until` text NOT NULL,
	PRIMARY KEY(`city`, `organizer_slug`, `uid`)
);--> statement-breakpoint
CREATE INDEX `csd_city_valid_until_idx` ON `calendar_suggestion_dismissals` (`city`, `valid_until`);
