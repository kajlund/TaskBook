import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const collectionStructure = pgEnum('collection_structure', ['FLAT', 'PHASED']);
export const collectionStatus = pgEnum('collection_status', [
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
]);
export const urgency = pgEnum('urgency', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const taskCollections = pgTable(
  'task_collections',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    description: text(),
    structure: collectionStructure().notNull(),
    status: collectionStatus().notNull().default('ACTIVE'),
    startDate: date('start_date'),
    targetEndDate: date('target_end_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    position: integer().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('collection_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check(
      'collection_dates_valid',
      sql`${t.startDate} IS NULL OR ${t.targetEndDate} IS NULL OR ${t.targetEndDate} >= ${t.startDate}`,
    ),
    uniqueIndex('active_collection_position_unique')
      .on(t.position)
      .where(sql`${t.status} <> 'ARCHIVED'`),
  ],
);

export const phases = pgTable(
  'phases',
  {
    id: uuid().primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => taskCollections.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    position: integer().notNull(),
    startDate: date('start_date'),
    targetEndDate: date('target_end_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('phase_id_collection_unique').on(t.id, t.collectionId),
    unique('phase_collection_position_unique').on(t.collectionId, t.position),
    check('phase_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check(
      'phase_dates_valid',
      sql`${t.startDate} IS NULL OR ${t.targetEndDate} IS NULL OR ${t.targetEndDate} >= ${t.startDate}`,
    ),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => taskCollections.id, { onDelete: 'cascade' }),
    phaseId: uuid('phase_id'),
    name: text().notNull(),
    description: text(),
    urgency: urgency().notNull().default('MEDIUM'),
    dueDate: date('due_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    position: integer().notNull(),
    waitingReason: text('waiting_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    check('task_name_not_blank', sql`length(trim(${t.name})) > 0`),
    uniqueIndex('task_phase_position_unique')
      .on(t.phaseId, t.position)
      .where(sql`${t.phaseId} IS NOT NULL AND ${t.archivedAt} IS NULL`),
    uniqueIndex('task_unphased_position_unique')
      .on(t.collectionId, t.position)
      .where(sql`${t.phaseId} IS NULL AND ${t.archivedAt} IS NULL`),
    unique('task_phase_collection_unique').on(t.id, t.collectionId),
    index('task_collection_idx').on(t.collectionId),
    foreignKey({
      columns: [t.phaseId, t.collectionId],
      foreignColumns: [phases.id, phases.collectionId],
      name: 'task_phase_same_collection_fk',
    }).onDelete('cascade'),
  ],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    check('dependency_not_self', sql`${t.taskId} <> ${t.dependsOnTaskId}`),
  ],
);
