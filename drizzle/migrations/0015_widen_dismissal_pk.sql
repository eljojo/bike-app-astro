-- Widen calendar_suggestion_dismissals PK from (city, uid) to (city, organizer_slug, uid).
-- Two organizer feeds can emit the same ICS UID (e.g. 'weekly-ride'); without
-- organizer_slug in the key, dismissing one would silently dismiss the other.
-- The branch this migration ships in has not been deployed; there is no production
-- data to preserve, so we drop and recreate. Add INSERT...SELECT with a placeholder
-- if this ever needs to run on a populated table.
DROP TABLE `calendar_suggestion_dismissals`;--> statement-breakpoint
CREATE TABLE `calendar_suggestion_dismissals` (
	`city` text NOT NULL,
	`organizer_slug` text NOT NULL,
	`uid` text NOT NULL,
	PRIMARY KEY(`city`, `organizer_slug`, `uid`)
);
