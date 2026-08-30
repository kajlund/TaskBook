export type ProgressTask = { completedAt: Date | string | null; archivedAt: Date | string | null };

export function calculateProgress(tasks: ProgressTask[]) {
  const active = tasks.filter((task) => task.archivedAt === null);
  const completed = active.filter((task) => task.completedAt !== null).length;

  return {
    completed,
    total: active.length,
    ratio: active.length === 0 ? 0 : completed / active.length,
  };
}

export function isPhaseComplete(tasks: ProgressTask[]) {
  const progress = calculateProgress(tasks);

  return progress.total > 0 && progress.completed === progress.total;
}
