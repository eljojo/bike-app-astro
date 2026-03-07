import { sqliteTable, text, integer, blob, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  username: text('username').notNull(),
  role: text('role', { enum: ['admin', 'editor', 'guest'] }).notNull().default('editor'),
  createdAt: text('created_at').notNull(),
  bannedAt: text('banned_at'),
  ipAddress: text('ip_address'),
  previousUsernames: text('previous_usernames'),
}, (table) => [
  uniqueIndex('users_username_idx').on(table.username),
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
  contentType: text('content_type').notNull(),
  contentSlug: text('content_slug').notNull(),
  data: text('data').notNull(),
  githubSha: text('github_sha').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.contentType, table.contentSlug] }),
]);

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  emailInCommits: integer('email_in_commits', { mode: 'boolean' }).notNull().default(false),
  analyticsOptOut: integer('analytics_opt_out', { mode: 'boolean' }).notNull().default(false),
});
