import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type {
  createCollectionSchema,
  createPhaseSchema,
  createTaskSchema,
  updateCollectionSchema,
  updatePhaseSchema,
  updateTaskSchema,
} from '@waymark/contracts';
import type { Database } from '../db/client.js';
import { phases, taskCollections, taskDependencies, tasks } from '../db/schema/index.js';
import { assertAcyclic } from '../domain/dependencies.js';
import { calculateProgress } from '../domain/progress.js';
import { validateReorder } from '../domain/ordering.js';
import { DomainError } from '../errors/domain-error.js';

const now = () => new Date();

export class WaymarkService {
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
    return rows.map((phase) => this.phaseSummary(phase, collectionTasks));
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
    };
  }

  async listTasks(filters: {
    collectionId?: string;
    phaseId?: string;
    unassigned?: boolean;
    completed?: boolean;
    includeArchived?: boolean;
  }) {
    const clauses = [];
    if (filters.collectionId) clauses.push(eq(tasks.collectionId, filters.collectionId));
    if (filters.phaseId) clauses.push(eq(tasks.phaseId, filters.phaseId));
    if (filters.unassigned) clauses.push(isNull(tasks.phaseId));
    if (filters.completed === true) clauses.push(sql`${tasks.completedAt} IS NOT NULL`);
    if (filters.completed === false) clauses.push(isNull(tasks.completedAt));
    if (!filters.includeArchived) clauses.push(isNull(tasks.archivedAt));
    return this.database
      .select()
      .from(tasks)
      .where(and(...clauses))
      .orderBy(asc(tasks.position));
  }

  async task(id: string) {
    const [task] = await this.database.select().from(tasks).where(eq(tasks.id, id));
    if (!task) throw new DomainError('TASK_NOT_FOUND', 'Task not found', 404);
    return task;
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
    if (input.phaseId !== undefined)
      await this.assertTaskScope(existing.collectionId, input.phaseId);
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

  async moveTask(id: string, phaseId: string | null, position: number) {
    return this.database.transaction(async (tx) => {
      const task = await this.task(id);
      await this.assertTaskScope(task.collectionId, phaseId);
      const target = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.collectionId, task.collectionId),
            phaseId ? eq(tasks.phaseId, phaseId) : isNull(tasks.phaseId),
            isNull(tasks.archivedAt),
            ne(tasks.id, id),
          ),
        )
        .orderBy(asc(tasks.position));
      const bounded = Math.min(position, target.length);
      await tx
        .update(tasks)
        .set({ position: sql`${tasks.position}+1000000` })
        .where(
          and(
            eq(tasks.collectionId, task.collectionId),
            phaseId ? eq(tasks.phaseId, phaseId) : isNull(tasks.phaseId),
            isNull(tasks.archivedAt),
          ),
        );
      const ordered = [...target];
      ordered.splice(bounded, 0, task);
      for (const [index, item] of ordered.entries())
        await tx
          .update(tasks)
          .set({ phaseId, position: index, updatedAt: now() })
          .where(eq(tasks.id, item.id));
      return this.task(id);
    });
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
    await this.task(id);
    const [updated] = await this.database
      .update(tasks)
      .set({ archivedAt: restore ? null : now(), updatedAt: now() })
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  async dependencies(taskId: string) {
    await this.task(taskId);
    return this.database.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId));
  }

  async addDependency(taskId: string, dependsOnTaskId: string) {
    await Promise.all([this.task(taskId), this.task(dependsOnTaskId)]);
    const edges = await this.database.select().from(taskDependencies);
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

  private async assertTaskScope(collectionId: string, phaseId: string | null) {
    const collection = await this.collection(collectionId);
    if (collection.structure === 'FLAT' && phaseId)
      throw new DomainError(
        'FLAT_TASK_PHASE',
        'Tasks in flat collections cannot belong to a phase',
        422,
      );
    if (phaseId) {
      const [phase] = await this.database
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
