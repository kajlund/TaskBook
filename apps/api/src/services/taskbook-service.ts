import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type {
  createCollectionSchema,
  createPhaseSchema,
  createTaskSchema,
  moveTaskSchema,
  updateCollectionSchema,
  updatePhaseSchema,
  updateTaskSchema,
} from '@taskbook/contracts';
import type { Database } from '../db/client.js';
import { phases, taskCollections, taskDependencies, tasks } from '../db/schema/index.js';
import { assertAcyclic } from '../domain/dependencies.js';
import { calculateProgress } from '../domain/progress.js';
import { validateReorder } from '../domain/ordering.js';
import { DomainError } from '../errors/domain-error.js';

const now = () => new Date();
type TaskDatabase = Pick<Database, 'select' | 'update'>;

export class TaskBookService {
  constructor(private database: Database) {}

  async collections(
    filters: {
      status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
      includeArchived?: boolean;
    } = {},
  ) {
    const rows = await this.database
      .select()
      .from(taskCollections)
      .where(
        filters.status
          ? eq(taskCollections.status, filters.status)
          : filters.includeArchived
            ? undefined
            : ne(taskCollections.status, 'ARCHIVED'),
      )
      .orderBy(asc(taskCollections.position));
    return Promise.all(
      rows.map(async (collection) => ({
        ...collection,
        progress: calculateProgress(
          await this.database.select().from(tasks).where(eq(tasks.collectionId, collection.id)),
        ),
      })),
    );
  }

  async collection(id: string) {
    const [collection] = await this.database
      .select()
      .from(taskCollections)
      .where(eq(taskCollections.id, id));
    if (!collection)
      throw new DomainError('COLLECTION_NOT_FOUND', 'Task collection not found', 404);
    const collectionTasks = await this.database
      .select()
      .from(tasks)
      .where(eq(tasks.collectionId, id));
    const impacts = await this.database
      .select({
        phaseCount: sql<number>`count(distinct ${phases.id})::int`,
        taskCount: sql<number>`count(distinct ${tasks.id})::int`,
        dependencyCount: sql<number>`(count(distinct (${taskDependencies.taskId}, ${taskDependencies.dependsOnTaskId})) filter (where ${taskDependencies.taskId} is not null))::int`,
      })
      .from(taskCollections)
      .leftJoin(phases, eq(phases.collectionId, taskCollections.id))
      .leftJoin(tasks, eq(tasks.collectionId, taskCollections.id))
      .leftJoin(
        taskDependencies,
        or(eq(taskDependencies.taskId, tasks.id), eq(taskDependencies.dependsOnTaskId, tasks.id)),
      )
      .where(eq(taskCollections.id, id));
    const impact = impacts[0];
    return {
      ...collection,
      progress: calculateProgress(collectionTasks),
      deletionImpact: {
        phases: impact?.phaseCount ?? 0,
        tasks: impact?.taskCount ?? 0,
        dependencyLinks: impact?.dependencyCount ?? 0,
      },
    };
  }

  async createCollection(input: z.infer<typeof createCollectionSchema>) {
    const counts = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(taskCollections)
      .where(ne(taskCollections.status, 'ARCHIVED'));
    const [created] = await this.database
      .insert(taskCollections)
      .values({ ...input, position: counts[0]?.count ?? 0 })
      .returning();
    return created;
  }

  async updateCollection(id: string, input: z.infer<typeof updateCollectionSchema>) {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(taskCollections).where(eq(taskCollections.id, id));
      if (!existing)
        throw new DomainError('COLLECTION_NOT_FOUND', 'Task collection not found', 404);
      const startDate = input.startDate === undefined ? existing.startDate : input.startDate;
      const targetEndDate =
        input.targetEndDate === undefined ? existing.targetEndDate : input.targetEndDate;
      if (startDate && targetEndDate && targetEndDate < startDate)
        throw new DomainError(
          'INVALID_COLLECTION_DATES',
          'Target end date cannot precede start date',
          422,
        );
      if (existing.structure === 'PHASED' && input.structure === 'FLAT') {
        const counts = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(phases)
          .where(eq(phases.collectionId, id));
        if ((counts[0]?.count ?? 0) > 0)
          throw new DomainError(
            'COLLECTION_HAS_PHASES',
            'Remove all phases before converting this collection to a simple task list',
            409,
          );
      }
      const values = {
        ...input,
        updatedAt: now(),
        ...(input.status === 'COMPLETED'
          ? { completedAt: existing.completedAt ?? now() }
          : input.status
            ? { completedAt: null }
            : {}),
      };
      const [updated] = await tx
        .update(taskCollections)
        .set(values)
        .where(eq(taskCollections.id, id))
        .returning();
      return updated;
    });
  }

  async reorderCollections(ids: string[]) {
    return this.database.transaction(async (tx) => {
      const current = await tx
        .select({ id: taskCollections.id })
        .from(taskCollections)
        .where(ne(taskCollections.status, 'ARCHIVED'))
        .orderBy(asc(taskCollections.position));
      const ordered = validateReorder(
        current.map((x) => x.id),
        ids,
      );
      await tx
        .update(taskCollections)
        .set({ position: sql`${taskCollections.position} + 1000000` })
        .where(inArray(taskCollections.id, ids));
      for (const item of ordered)
        await tx
          .update(taskCollections)
          .set({ position: item.position, updatedAt: now() })
          .where(eq(taskCollections.id, item.id));
      return ordered;
    });
  }

  async archiveCollection(id: string, restore = false) {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(taskCollections).where(eq(taskCollections.id, id));
      if (!existing)
        throw new DomainError('COLLECTION_NOT_FOUND', 'Task collection not found', 404);
      if (restore) {
        const counts = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(taskCollections)
          .where(ne(taskCollections.status, 'ARCHIVED'));
        const [restored] = await tx
          .update(taskCollections)
          .set({ status: 'ACTIVE', position: counts[0]?.count ?? 0, updatedAt: now() })
          .where(eq(taskCollections.id, id))
          .returning();
        return restored;
      }
      const [archived] = await tx
        .update(taskCollections)
        .set({ status: 'ARCHIVED', updatedAt: now() })
        .where(eq(taskCollections.id, id))
        .returning();
      const active = await tx
        .select({ id: taskCollections.id })
        .from(taskCollections)
        .where(ne(taskCollections.status, 'ARCHIVED'))
        .orderBy(asc(taskCollections.position));
      await tx
        .update(taskCollections)
        .set({ position: sql`${taskCollections.position} + 1000000` })
        .where(
          inArray(
            taskCollections.id,
            active.map((item) => item.id),
          ),
        );
      for (const [position, item] of active.entries())
        await tx.update(taskCollections).set({ position }).where(eq(taskCollections.id, item.id));
      return archived;
    });
  }

  async deleteCollection(id: string) {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(taskCollections).where(eq(taskCollections.id, id));
      if (!existing)
        throw new DomainError('COLLECTION_NOT_FOUND', 'Task collection not found', 404);
      if (existing.status !== 'ARCHIVED')
        throw new DomainError(
          'COLLECTION_NOT_ARCHIVED',
          'Only archived collections can be permanently deleted',
          409,
        );
      const ownedTasks = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.collectionId, id));
      const taskIds = ownedTasks.map((task) => task.id);
      if (taskIds.length)
        await tx
          .delete(taskDependencies)
          .where(
            or(
              inArray(taskDependencies.taskId, taskIds),
              inArray(taskDependencies.dependsOnTaskId, taskIds),
            ),
          );
      await tx.delete(taskCollections).where(eq(taskCollections.id, id));
    });
  }

  async listPhases(collectionId: string) {
    await this.collection(collectionId);
    const rows = await this.database
      .select()
      .from(phases)
      .where(eq(phases.collectionId, collectionId))
      .orderBy(asc(phases.position));
    const collectionTasks = await this.database
      .select()
      .from(tasks)
      .where(eq(tasks.collectionId, collectionId));
    return rows.map((phase) =>
      this.phaseSummary(
        phase,
        collectionTasks.filter((task) => task.phaseId === phase.id),
      ),
    );
  }

  async phase(id: string) {
    const [phase] = await this.database.select().from(phases).where(eq(phases.id, id));
    if (!phase) throw new DomainError('PHASE_NOT_FOUND', 'Phase not found', 404);
    const phaseTasks = await this.database.select().from(tasks).where(eq(tasks.phaseId, id));
    return this.phaseSummary(phase, phaseTasks);
  }

  async createPhase(collectionId: string, input: z.infer<typeof createPhaseSchema>) {
    const collection = await this.collection(collectionId);
    if (collection.structure !== 'PHASED')
      throw new DomainError('FLAT_COLLECTION_PHASE', 'Flat collections cannot contain phases', 409);
    const counts = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(phases)
      .where(eq(phases.collectionId, collectionId));
    const [created] = await this.database
      .insert(phases)
      .values({ ...input, collectionId, position: counts[0]?.count ?? 0 })
      .returning();
    return this.phaseSummary(created!, []);
  }

  async updatePhase(id: string, input: z.infer<typeof updatePhaseSchema>) {
    const existing = await this.phase(id);
    const startDate = input.startDate === undefined ? existing.startDate : input.startDate;
    const targetEndDate =
      input.targetEndDate === undefined ? existing.targetEndDate : input.targetEndDate;
    if (startDate && targetEndDate && targetEndDate < startDate)
      throw new DomainError(
        'INVALID_PHASE_DATES',
        'Target end date cannot precede start date',
        422,
      );
    await this.database
      .update(phases)
      .set({ ...input, updatedAt: now() })
      .where(eq(phases.id, id));
    return this.phase(id);
  }

  async reorderPhases(collectionId: string, ids: string[]) {
    return this.database.transaction(async (tx) => {
      const current = await tx
        .select({ id: phases.id })
        .from(phases)
        .where(eq(phases.collectionId, collectionId))
        .orderBy(asc(phases.position));
      const ordered = validateReorder(
        current.map((x) => x.id),
        ids,
      );
      await tx
        .update(phases)
        .set({ position: sql`${phases.position}+1000000` })
        .where(eq(phases.collectionId, collectionId));
      for (const item of ordered)
        await tx
          .update(phases)
          .set({ position: item.position, updatedAt: now() })
          .where(and(eq(phases.id, item.id), eq(phases.collectionId, collectionId)));
      return ordered;
    });
  }

  async deletePhase(id: string) {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(phases).where(eq(phases.id, id));
      if (!existing) throw new DomainError('PHASE_NOT_FOUND', 'Phase not found', 404);
      const counts = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.phaseId, id));
      if ((counts[0]?.count ?? 0) > 0)
        throw new DomainError(
          'PHASE_NOT_EMPTY',
          'Tasks still reference this phase. Move or delete them before deleting the phase.',
          409,
        );
      const [deleted] = await tx.delete(phases).where(eq(phases.id, id)).returning();
      const remaining = await tx
        .select({ id: phases.id })
        .from(phases)
        .where(eq(phases.collectionId, existing.collectionId))
        .orderBy(asc(phases.position));
      await tx
        .update(phases)
        .set({ position: sql`${phases.position} + 1000000` })
        .where(eq(phases.collectionId, existing.collectionId));
      for (const [position, item] of remaining.entries())
        await tx.update(phases).set({ position, updatedAt: now() }).where(eq(phases.id, item.id));
      return deleted;
    });
  }

  private phaseSummary<T extends typeof phases.$inferSelect>(
    phase: T,
    phaseTasks: Array<typeof tasks.$inferSelect>,
  ) {
    const progress = calculateProgress(phaseTasks);
    return {
      ...phase,
      taskCount: progress.total,
      completedTaskCount: progress.completed,
      progress: progress.ratio,
      isComplete: progress.total > 0 && progress.completed === progress.total,
      hasTasks: phaseTasks.length > 0,
      totalTaskCount: phaseTasks.length,
    };
  }

  async listTasks(filters: {
    collectionId?: string;
    phaseId?: string;
    unassigned?: boolean;
    completed?: boolean;
    includeArchived?: boolean;
    waiting?: boolean;
    urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    dueBefore?: string;
    dueAfter?: string;
  }) {
    const clauses = [];
    if (filters.collectionId) clauses.push(eq(tasks.collectionId, filters.collectionId));
    if (filters.phaseId) clauses.push(eq(tasks.phaseId, filters.phaseId));
    if (filters.unassigned) clauses.push(isNull(tasks.phaseId));
    if (filters.completed === true) clauses.push(sql`${tasks.completedAt} IS NOT NULL`);
    if (filters.completed === false) clauses.push(isNull(tasks.completedAt));
    if (filters.urgency) clauses.push(eq(tasks.urgency, filters.urgency));
    if (filters.dueBefore) clauses.push(lte(tasks.dueDate, filters.dueBefore));
    if (filters.dueAfter) clauses.push(gt(tasks.dueDate, filters.dueAfter));
    if (filters.waiting === true)
      clauses.push(
        sql`${tasks.waitingReason} IS NOT NULL OR EXISTS (SELECT 1 FROM ${taskDependencies} d JOIN ${tasks} dependency ON dependency.id = d.depends_on_task_id WHERE d.task_id = ${tasks.id} AND dependency.completed_at IS NULL AND dependency.archived_at IS NULL)`,
      );
    if (filters.waiting === false)
      clauses.push(
        sql`${tasks.waitingReason} IS NULL AND NOT EXISTS (SELECT 1 FROM ${taskDependencies} d JOIN ${tasks} dependency ON dependency.id = d.depends_on_task_id WHERE d.task_id = ${tasks.id} AND dependency.completed_at IS NULL AND dependency.archived_at IS NULL)`,
      );
    if (!filters.includeArchived) clauses.push(isNull(tasks.archivedAt));
    const query = this.database
      .select()
      .from(tasks)
      .where(and(...clauses));
    if (filters.completed === true) return query.orderBy(desc(tasks.completedAt));
    if (filters.dueBefore || filters.dueAfter)
      return query.orderBy(asc(tasks.dueDate), asc(tasks.collectionId), asc(tasks.position));
    return query.orderBy(asc(tasks.position));
  }

  async task(id: string) {
    const [task] = await this.database.select().from(tasks).where(eq(tasks.id, id));
    if (!task) throw new DomainError('TASK_NOT_FOUND', 'Task not found', 404);
    const dependencyRows = await this.dependenciesFor(id);
    const blockingRows = await this.database
      .select({ task: tasks })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(eq(taskDependencies.dependsOnTaskId, id));
    return {
      ...task,
      dependencies: dependencyRows,
      blockedTasks: blockingRows.map((row) => row.task),
      isWaiting:
        task.waitingReason !== null || dependencyRows.some((item) => item.completedAt === null),
    };
  }

  async createTask(input: z.infer<typeof createTaskSchema>) {
    await this.assertTaskScope(input.collectionId, input.phaseId ?? null);
    const scope = input.phaseId
      ? eq(tasks.phaseId, input.phaseId)
      : and(eq(tasks.collectionId, input.collectionId), isNull(tasks.phaseId));
    const counts = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(scope, isNull(tasks.archivedAt)));
    const [created] = await this.database
      .insert(tasks)
      .values({ ...input, phaseId: input.phaseId ?? null, position: counts[0]?.count ?? 0 })
      .returning();
    return created;
  }

  async updateTask(id: string, input: z.infer<typeof updateTaskSchema>) {
    const existing = await this.task(id);
    if (input.phaseId !== undefined && input.phaseId !== existing.phaseId) {
      const { phaseId, ...details } = input;
      return this.moveTask(id, {
        destinationCollectionId: existing.collectionId,
        destinationPhaseId: phaseId,
        ...details,
      });
    }
    const [updated] = await this.database
      .update(tasks)
      .set({ ...input, updatedAt: now() })
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  async reorderTasks(ids: string[]) {
    return this.database.transaction(async (tx) => {
      const rows = await tx.select().from(tasks).where(inArray(tasks.id, ids));
      if (rows.length !== ids.length)
        throw new DomainError('INVALID_REORDER', 'One or more tasks do not exist', 422);
      const first = rows[0]!;
      if (rows.some((t) => t.collectionId !== first.collectionId || t.phaseId !== first.phaseId))
        throw new DomainError('CROSS_SCOPE_REORDER', 'Tasks must share one ordering scope', 422);
      const current = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.collectionId, first.collectionId),
            first.phaseId ? eq(tasks.phaseId, first.phaseId) : isNull(tasks.phaseId),
            isNull(tasks.archivedAt),
          ),
        )
        .orderBy(asc(tasks.position));
      const ordered = validateReorder(
        current.map((x) => x.id),
        ids,
      );
      await tx
        .update(tasks)
        .set({ position: sql`${tasks.position}+1000000` })
        .where(inArray(tasks.id, ids));
      for (const item of ordered)
        await tx
          .update(tasks)
          .set({ position: item.position, updatedAt: now() })
          .where(eq(tasks.id, item.id));
      return ordered;
    });
  }

  async moveTask(id: string, input: z.infer<typeof moveTaskSchema>) {
    await this.database.transaction(async (tx) => {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update');
      if (!task) throw new DomainError('TASK_NOT_FOUND', 'Task not found', 404);

      const [destinationCollection] = await tx
        .select()
        .from(taskCollections)
        .where(eq(taskCollections.id, input.destinationCollectionId))
        .for('update');
      if (!destinationCollection)
        throw new DomainError('COLLECTION_NOT_FOUND', 'Task collection not found', 404);
      if (destinationCollection.status === 'ARCHIVED')
        throw new DomainError(
          'ARCHIVED_DESTINATION',
          'Archived collections cannot receive tasks',
          409,
        );

      let destinationPhase = null;
      if (input.destinationPhaseId) {
        const [phase] = await tx
          .select()
          .from(phases)
          .where(eq(phases.id, input.destinationPhaseId))
          .for('update');
        if (!phase) throw new DomainError('PHASE_NOT_FOUND', 'Phase not found', 404);
        destinationPhase = phase;
        if (destinationCollection.structure === 'FLAT')
          throw new DomainError(
            'FLAT_TASK_PHASE',
            'Tasks in flat collections cannot belong to a phase',
            422,
          );
        if (phase.collectionId !== destinationCollection.id)
          throw new DomainError(
            'CROSS_COLLECTION_PHASE',
            'Phase must belong to the destination collection',
            422,
          );
      }

      const sameScope =
        task.collectionId === destinationCollection.id &&
        task.phaseId === (destinationPhase?.id ?? null);
      const {
        destinationCollectionId: _collection,
        destinationPhaseId: _phase,
        ...details
      } = input;
      if (sameScope) {
        if (Object.keys(details).length)
          await tx
            .update(tasks)
            .set({ ...details, updatedAt: now() })
            .where(eq(tasks.id, id));
        return;
      }
      if (task.archivedAt)
        throw new DomainError(
          'ARCHIVED_TASK_MOVE',
          'Restore this archived task before moving it',
          409,
        );

      await tx
        .update(tasks)
        .set({ position: sql`${tasks.position} + 2000000` })
        .where(eq(tasks.id, id));
      await this.normalizeTaskScope(tx, task.collectionId, task.phaseId, id);
      await this.normalizeTaskScope(tx, destinationCollection.id, destinationPhase?.id ?? null, id);
      const destination = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.collectionId, destinationCollection.id),
            destinationPhase ? eq(tasks.phaseId, destinationPhase.id) : isNull(tasks.phaseId),
            isNull(tasks.archivedAt),
            ne(tasks.id, id),
          ),
        );
      await tx
        .update(tasks)
        .set({
          ...details,
          collectionId: destinationCollection.id,
          phaseId: destinationPhase?.id ?? null,
          position: destination.length,
          updatedAt: now(),
        })
        .where(eq(tasks.id, id));
    });
    return this.task(id);
  }

  async completeTask(id: string, reopen = false) {
    await this.task(id);
    const [updated] = await this.database
      .update(tasks)
      .set({ completedAt: reopen ? null : now(), updatedAt: now() })
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  async archiveTask(id: string, restore = false) {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(tasks).where(eq(tasks.id, id));
      if (!existing) throw new DomainError('TASK_NOT_FOUND', 'Task not found', 404);
      if (restore) {
        const [collection] = await tx
          .select()
          .from(taskCollections)
          .where(eq(taskCollections.id, existing.collectionId));
        let phaseId = existing.phaseId;
        if (phaseId) {
          const [phase] = await tx
            .select({ id: phases.id })
            .from(phases)
            .where(eq(phases.id, phaseId));
          if (!phase) phaseId = null;
        }
        if (collection?.structure === 'FLAT') phaseId = null;
        const active = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.collectionId, existing.collectionId),
              phaseId ? eq(tasks.phaseId, phaseId) : isNull(tasks.phaseId),
              isNull(tasks.archivedAt),
            ),
          );
        const [updated] = await tx
          .update(tasks)
          .set({ archivedAt: null, phaseId, position: active.length, updatedAt: now() })
          .where(eq(tasks.id, id))
          .returning();
        return updated;
      }
      const [updated] = await tx
        .update(tasks)
        .set({ archivedAt: now(), updatedAt: now() })
        .where(eq(tasks.id, id))
        .returning();
      await this.normalizeTaskScope(tx, existing.collectionId, existing.phaseId, id);
      return updated;
    });
  }

  async deleteTask(id: string) {
    return this.database.transaction(async (tx) => {
      const [existing] = await tx.select().from(tasks).where(eq(tasks.id, id));
      if (!existing) throw new DomainError('TASK_NOT_FOUND', 'Task not found', 404);
      if (!existing.archivedAt)
        throw new DomainError(
          'TASK_NOT_ARCHIVED',
          'Only archived tasks can be permanently deleted',
          409,
        );
      await tx
        .delete(taskDependencies)
        .where(or(eq(taskDependencies.taskId, id), eq(taskDependencies.dependsOnTaskId, id)));
      await tx.delete(tasks).where(eq(tasks.id, id));
    });
  }

  async dependencies(taskId: string) {
    const [task] = await this.database
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!task) throw new DomainError('TASK_NOT_FOUND', 'Task not found', 404);
    return this.dependenciesFor(taskId);
  }

  async addDependency(taskId: string, dependsOnTaskId: string) {
    const [task, dependency] = await Promise.all([this.task(taskId), this.task(dependsOnTaskId)]);
    if (dependency.archivedAt)
      throw new DomainError(
        'ARCHIVED_DEPENDENCY',
        'Archived tasks cannot be added as dependencies',
        409,
      );
    if (task.collectionId !== dependency.collectionId)
      throw new DomainError(
        'CROSS_COLLECTION_DEPENDENCY',
        'Dependencies must belong to the same collection',
        409,
      );
    const edges = await this.database.select().from(taskDependencies);
    if (edges.some((edge) => edge.taskId === taskId && edge.dependsOnTaskId === dependsOnTaskId))
      throw new DomainError('DUPLICATE_DEPENDENCY', 'This dependency already exists', 409);
    assertAcyclic(taskId, dependsOnTaskId, edges);
    const [created] = await this.database
      .insert(taskDependencies)
      .values({ taskId, dependsOnTaskId })
      .returning();
    return created;
  }

  async removeDependency(taskId: string, dependsOnTaskId: string) {
    await this.database
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
        ),
      );
  }

  private async dependenciesFor(taskId: string) {
    const rows = await this.database
      .select({ task: tasks })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(eq(taskDependencies.taskId, taskId));
    return rows.map((row) => row.task);
  }

  private async normalizeTaskScope(
    database: TaskDatabase,
    collectionId: string,
    phaseId: string | null,
    excludedId?: string,
  ) {
    const scope = await database
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.collectionId, collectionId),
          phaseId ? eq(tasks.phaseId, phaseId) : isNull(tasks.phaseId),
          isNull(tasks.archivedAt),
          excludedId ? ne(tasks.id, excludedId) : undefined,
        ),
      )
      .orderBy(asc(tasks.position));
    if (!scope.length) return;
    await database
      .update(tasks)
      .set({ position: sql`${tasks.position} + 1000000` })
      .where(
        inArray(
          tasks.id,
          scope.map((item) => item.id),
        ),
      );
    for (const [position, item] of scope.entries())
      await database.update(tasks).set({ position, updatedAt: now() }).where(eq(tasks.id, item.id));
  }

  private async assertTaskScope(
    collectionId: string,
    phaseId: string | null,
    database: TaskDatabase = this.database,
  ) {
    const [collection] = await database
      .select()
      .from(taskCollections)
      .where(eq(taskCollections.id, collectionId));
    if (!collection)
      throw new DomainError('COLLECTION_NOT_FOUND', 'Task collection not found', 404);
    if (collection.structure === 'FLAT' && phaseId)
      throw new DomainError(
        'FLAT_TASK_PHASE',
        'Tasks in flat collections cannot belong to a phase',
        422,
      );
    if (phaseId) {
      const [phase] = await database
        .select()
        .from(phases)
        .where(and(eq(phases.id, phaseId), eq(phases.collectionId, collectionId)));
      if (!phase)
        throw new DomainError(
          'CROSS_COLLECTION_PHASE',
          'Phase must belong to the task collection',
          422,
        );
    }
  }
}
