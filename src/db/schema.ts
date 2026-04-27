import { sqliteTable, text, integer, real, blob, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  username: text('username').notNull(),
  role: text('role', { enum: ['admin', 'editor', 'guest'] }).notNull().default('editor'),
  createdAt: text('created_at').notNull(),
  bannedAt: text('banned_at'),
  emailVerified: integer('email_verified').notNull().default(1),
  ipAddress: text('ip_address'),
  previousUsernames: text('previous_usernames'),
}, (table) => [
  uniqueIndex('users_username_idx').on(table.username),
  index('users_created_at_idx').on(table.createdAt),
]);

export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: blob('public_key', { mode: 'buffer' }).notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports'), // JSON array
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('credentials_user_id_idx').on(table.userId),
]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('sessions_expires_at_idx').on(table.expiresAt),
  index('sessions_user_id_idx').on(table.userId),
]);

export const bannedIps = sqliteTable('banned_ips', {
  ip: text('ip').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  bannedAt: text('banned_at').notNull(),
}, (table) => [
  index('banned_ips_user_id_idx').on(table.userId),
]);

export const uploadAttempts = sqliteTable('upload_attempts', {
  action: text('action').notNull(),
  identifier: text('identifier').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('upload_attempts_lookup_idx').on(table.action, table.identifier, table.createdAt),
]);

export const contentEdits = sqliteTable('content_edits', {
  city: text('city').notNull(),
  contentType: text('content_type').notNull(),
  contentSlug: text('content_slug').notNull(),
  data: text('data').notNull(),
  githubSha: text('github_sha').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.city, table.contentType, table.contentSlug] }),
]);

export const reactions = sqliteTable('reactions', {
  id: text('id').primaryKey(),
  city: text('city').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  contentSlug: text('content_slug').notNull(),
  reactionType: text('reaction_type').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('reactions_content_idx').on(table.city, table.contentType, table.contentSlug),
  index('reactions_user_idx').on(table.userId),
  uniqueIndex('reactions_unique_idx').on(table.city, table.userId, table.contentType, table.contentSlug, table.reactionType),
  index('reactions_city_created_idx').on(table.city, table.createdAt),
  index('reactions_city_type_created_idx').on(table.city, table.contentType, table.reactionType, table.createdAt),
]);

export const emailTokens = sqliteTable('email_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  usedAt: text('used_at'),
}, (table) => [
  index('email_tokens_email_idx').on(table.email),
]);

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  emailInCommits: integer('email_in_commits', { mode: 'boolean' }).notNull().default(false),
  analyticsOptOut: integer('analytics_opt_out', { mode: 'boolean' }).notNull().default(false),
});

export const stravaTokens = sqliteTable('strava_tokens', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const videoJobs = sqliteTable('video_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  contentKind: text('content_kind').notNull(),
  contentSlug: text('content_slug').notNull(),
  jobId: text('job_id'),
  status: text('status').notNull().default('uploading'),
  width: integer('width'),
  height: integer('height'),
  duration: text('duration'),
  orientation: text('orientation'),
  lat: real('lat'),
  lng: real('lng'),
  capturedAt: text('captured_at'),
  title: text('title'),
  handle: text('handle'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Analytics Cache Tables (reconstructable from Plausible API + internal data) ---

export const contentDailyMetrics = sqliteTable('content_daily_metrics', {
  city: text('city').notNull(),
  contentType: text('content_type').notNull(),
  contentSlug: text('content_slug').notNull(),
  pageType: text('page_type').notNull(),
  date: text('date').notNull(),
  pageviews: integer('pageviews').notNull().default(0),
  visitorDays: integer('visitor_days').notNull().default(0),
  visitDurationS: real('visit_duration_s').notNull().default(0),
  bounceRate: real('bounce_rate').notNull().default(0),
  videoPlays: integer('video_plays').notNull().default(0),
  entryVisitors: integer('entry_visitors').notNull().default(0),
  gpxDownloads: integer('gpx_downloads').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.city, table.contentType, table.contentSlug, table.pageType, table.date] }),
  index('cdm_date_idx').on(table.city, table.date),
  index('cdm_type_date_idx').on(table.city, table.contentType, table.date),
]);

export const contentTotals = sqliteTable('content_totals', {
  city: text('city').notNull(),
  contentType: text('content_type').notNull(),
  contentSlug: text('content_slug').notNull(),
  pageType: text('page_type').notNull(),
  pageviews: integer('pageviews').notNull().default(0),
  visitorDays: integer('visitor_days').notNull().default(0),
  visitDurationS: real('visit_duration_s').notNull().default(0),
  bounceRate: real('bounce_rate').notNull().default(0),
  videoPlays: integer('video_plays').notNull().default(0),
  gpxDownloads: integer('gpx_downloads').notNull().default(0),
  syncedAt: text('synced_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.city, table.contentType, table.contentSlug, table.pageType] }),
]);

export const contentEngagement = sqliteTable('content_engagement', {
  city: text('city').notNull(),
  contentType: text('content_type').notNull(),
  contentSlug: text('content_slug').notNull(),
  totalPageviews: integer('total_pageviews').notNull().default(0),
  totalVisitorDays: integer('total_visitor_days').notNull().default(0),
  avgVisitDuration: real('avg_visit_duration').notNull().default(0),
  avgBounceRate: real('avg_bounce_rate').notNull().default(0),
  stars: integer('stars').notNull().default(0),
  videoPlayRate: real('video_play_rate').notNull().default(0),
  mapConversionRate: real('map_conversion_rate').notNull().default(0),
  wallTimeHours: real('wall_time_hours').notNull().default(0),
  engagementScore: real('engagement_score').notNull().default(0),
  lastSyncedAt: text('last_synced_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.city, table.contentType, table.contentSlug] }),
  index('ce_type_pageviews_idx').on(table.city, table.contentType, table.totalPageviews),
  index('ce_type_duration_idx').on(table.city, table.contentType, table.avgVisitDuration),
  index('ce_type_engagement_idx').on(table.city, table.contentType, table.engagementScore),
  index('ce_type_walltime_idx').on(table.city, table.contentType, table.wallTimeHours),
]);

export const siteDailyMetrics = sqliteTable('site_daily_metrics', {
  city: text('city').notNull(),
  date: text('date').notNull(),
  totalPageviews: integer('total_pageviews').notNull().default(0),
  uniqueVisitors: integer('unique_visitors').notNull().default(0),
  // Plausible's site-wide visit_duration = avg seconds per visit (NOT total).
  // Column name is misleading but kept for migration compatibility.
  totalDurationS: real('total_duration_s').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.city, table.date] }),
]);

export const siteEventMetrics = sqliteTable('site_event_metrics', {
  city: text('city').notNull(),
  eventName: text('event_name').notNull(),
  date: text('date').notNull(),
  dimensionValue: text('dimension_value').notNull(),
  visitors: integer('visitors').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.city, table.eventName, table.date, table.dimensionValue] }),
]);

export const statsCache = sqliteTable('stats_cache', {
  city: text('city').notNull(),
  cacheKey: text('cache_key').notNull(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.city, table.cacheKey] }),
]);

// --- Calendar Suggestion Dismissals ---
//
// Stores the set of ICS event UIDs an admin has explicitly dismissed for a given city.
// The only access patterns are "list dismissed UIDs for this city" and "mark UID as
// dismissed". Set-membership semantics — no metadata (who/when/snapshot) because the
// current feature doesn't surface any of it. Add columns when a feature demands them.
//
// The feed cache (parsed upstream ICS) lives in KV under the TILE_CACHE binding, with
// `calfeed:feed:v2:` key prefix — see src/lib/calendar-feed-cache/.
export const calendarSuggestionDismissals = sqliteTable('calendar_suggestion_dismissals', {
  city: text('city').notNull(),
  uid:  text('uid').notNull(),
}, (table) => [
  primaryKey({ columns: [table.city, table.uid] }),
]);
