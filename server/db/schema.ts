import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex,
} from 'drizzle-orm/pg-core';

// Keep existing IDs (including demo-*), epoch milliseconds and column names.
// PostgreSQL booleans/JSONB need explicit conversion in the future store/API adapter.
const milliseconds = (name: string) => bigint(name, { mode: 'number' });
// SQLite NOCASE folds ASCII only. lower() would change uniqueness for accented names.
const nocase = (column: SQLWrapper) => sql`translate(${column}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;

export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  // Includes revision, journal_version and balance_start (epoch milliseconds).
  value: bigint('value', { mode: 'number' }).notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').notNull(),
  password: text('password').notNull(), // Existing salt:scrypt hash, never plaintext.
  role: text('role', { enum: ['member', 'manager'] }).notNull(),
  active: boolean('active').notNull().default(true),
  color: text('color').notNull(),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
}, table => [
  uniqueIndex('users_username_nocase').on(nocase(table.username)),
  check('users_role_check', sql`${table.role} IN ('member', 'manager')`),
]);

// Administrator privileges remain separate from the base member/manager role.
export const userAdmins = pgTable('user_admins', {
  user_id: text('user_id').primaryKey().references(() => users.id, { onDelete: 'no action' }),
});

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(), // SHA-256 digest of the session cookie.
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'no action' }),
  csrf: text('csrf').notNull(),
  expires: milliseconds('expires').notNull(),
}, table => [
  index('sessions_user').on(table.user_id),
  index('sessions_expires').on(table.expires),
]);

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  created_by: text('created_by').notNull().references(() => users.id, { onDelete: 'no action' }),
}, table => [
  uniqueIndex('clients_name_nocase').on(nocase(table.name)),
]);

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  client_id: text('client_id').notNull().references(() => clients.id, { onDelete: 'no action' }),
  color: text('color').notNull(),
  description: text('description').notNull().default(''),
  archived: boolean('archived').notNull().default(false),
  version: integer('version').notNull().default(1),
  created_by: text('created_by').notNull().references(() => users.id, { onDelete: 'no action' }),
}, table => [
  uniqueIndex('projects_client_name_nocase').on(table.client_id, nocase(table.name)),
  index('projects_client').on(table.client_id),
]);

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  project_id: text('project_id').notNull().references(() => projects.id, { onDelete: 'no action' }),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['todo', 'doing', 'done'] }).notNull().default('todo'),
  archived: boolean('archived').notNull().default(false),
  version: integer('version').notNull().default(1),
  created_by: text('created_by').notNull().references(() => users.id, { onDelete: 'no action' }),
}, table => [
  check('tasks_status_check', sql`${table.status} IN ('todo', 'doing', 'done')`),
  index('tasks_project').on(table.project_id),
]);

export const assignments = pgTable('assignments', {
  task_id: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'no action' }),
}, table => [
  primaryKey({ columns: [table.task_id, table.user_id] }),
  index('assignments_user').on(table.user_id),
]);

export const entries = pgTable('entries', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'no action' }),
  task_id: text('task_id').references(() => tasks.id, { onDelete: 'no action' }),
  project_id: text('project_id').references(() => projects.id, { onDelete: 'no action' }),
  description: text('description').notNull().default(''),
  start: milliseconds('start').notNull(),
  end: milliseconds('end'),
  version: integer('version').notNull().default(1),
  deleted: boolean('deleted').notNull().default(false),
  created_at: milliseconds('created_at').notNull(),
  updated_at: milliseconds('updated_at').notNull(),
}, table => [
  check('entries_period_check', sql`${table.end} IS NULL OR ${table.end} >= ${table.start}`),
  uniqueIndex('one_running_per_user').on(table.user_id)
    .where(sql`${table.end} IS NULL AND ${table.deleted} = false`),
  index('entries_period').on(table.user_id, table.start, table.end),
  index('entries_task').on(table.task_id),
  index('entries_project').on(table.project_id),
]);

export const audit = pgTable('audit', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull().references(() => users.id, { onDelete: 'no action' }),
  entity: text('entity').notNull(),
  entity_id: text('entity_id').notNull(),
  owner: text('owner').references(() => users.id, { onDelete: 'no action' }),
  action: text('action').notNull(),
  // Exact strings are part of the existing journal hashes. Never normalize to JSONB.
  before_json: text('before_json'),
  after_json: text('after_json'),
  at: milliseconds('at').notNull(),
}, table => [
  index('audit_entity').on(table.entity, table.entity_id),
  index('audit_owner_at').on(table.owner, table.at),
]);

export const requests = pgTable('requests', {
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'no action' }),
  key: text('key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  at: milliseconds('at').notNull(),
}, table => [
  primaryKey({ columns: [table.user_id, table.key] }),
  index('requests_at').on(table.at),
]);

export const exportTemplates = pgTable('export_templates', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'no action' }),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  version: integer('version').notNull().default(1),
  created_at: milliseconds('created_at').notNull(),
  updated_at: milliseconds('updated_at').notNull(),
}, table => [
  index('export_templates_user').on(table.user_id),
]);

export const eventLog = pgTable('event_log', {
  // Manually allocated under a transaction lock: sequence/identity gaps break verification.
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  at: milliseconds('at').notNull(),
  level: text('level', { enum: ['info', 'warning', 'error'] }).notNull(),
  category: text('category').notNull(),
  action: text('action').notNull(),
  actor: text('actor'), // Technical events can refer to an absent user; intentionally no FK.
  entity: text('entity'),
  entity_id: text('entity_id'),
  request_id: text('request_id'),
  details_json: text('details_json').notNull(),
  previous_hash: text('previous_hash').notNull(),
  hash: text('hash').notNull(),
}, table => [
  check('event_log_level_check', sql`${table.level} IN ('info', 'warning', 'error')`),
  index('event_log_request').on(table.request_id, table.seq),
  index('event_log_level').on(table.level, table.seq),
  index('event_log_category').on(table.category, table.seq),
]);
