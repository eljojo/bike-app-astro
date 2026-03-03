import { sqliteTable, text, integer, blob, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'editor', 'guest'] }).notNull().default('editor'),
  createdAt: text('created_at').notNull(),
});

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

export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  contentSlug: text('content_slug').notNull(),
  branchName: text('branch_name').notNull(),
  prNumber: integer('pr_number'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('drafts_user_content_idx').on(table.userId, table.contentType, table.contentSlug),
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
