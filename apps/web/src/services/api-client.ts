export type CollectionStructure = 'FLAT' | 'PHASED';
export type CollectionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
export type Progress = { completed: number; total: number; ratio: number };
export type Collection = {
  id: string;
  name: string;
  description: string | null;
  structure: CollectionStructure;
  status: CollectionStatus;
  startDate: string | null;
  targetEndDate: string | null;
  position: number;
  progress: Progress;
  deletionImpact?: { phases: number; tasks: number; dependencyLinks: number };
};
export type Phase = {
  id: string;
  collectionId: string;
  name: string;
  description: string | null;
  position: number;
  startDate: string | null;
  targetEndDate: string | null;
  taskCount: number;
  completedTaskCount: number;
  progress: number;
  isComplete: boolean;
  hasTasks?: boolean;
  totalTaskCount?: number;
};
export type PhaseInput = Pick<Phase, 'name' | 'description' | 'startDate' | 'targetEndDate'>;
export type Task = {
  id: string;
  collectionId: string;
  name: string;
  description: string | null;
  phaseId: string | null;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  completedAt: string | null;
  dueDate: string | null;
  waitingReason: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  dependencies?: Task[];
  blockedTasks?: Task[];
  isWaiting?: boolean;
};
export type TaskInput = Pick<
  Task,
  'collectionId' | 'phaseId' | 'name' | 'description' | 'urgency' | 'dueDate' | 'waitingReason'
>;
export type MoveTaskInput = Omit<TaskInput, 'collectionId' | 'phaseId'> & {
  destinationCollectionId: string;
  destinationPhaseId: string | null;
};
export type TaskFilters = Partial<{
  collectionId: string;
  phaseId: string;
  unassigned: boolean;
  completed: boolean;
  waiting: boolean;
  urgency: Task['urgency'];
  dueBefore: string;
  dueAfter: string;
  includeArchived: boolean;
}>;
export type CollectionInput = {
  name: string;
  description: string | null;
  structure: CollectionStructure;
  status?: CollectionStatus;
  startDate: string | null;
  targetEndDate: string | null;
};
const baseUrl =
  import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as { data: T }).data;
}
export const api = {
  collections: (includeArchived = false) =>
    request<Collection[]>(`/collections${includeArchived ? '?includeArchived=true' : ''}`),
  collection: (id: string) => request<Collection>(`/collections/${id}`),
  phases: (id: string) => request<Phase[]>(`/collections/${id}/phases`),
  phase: (id: string) => request<Phase>(`/phases/${id}`),
  tasks: (filters: string | TaskFilters = {}) => {
    const values: TaskFilters = typeof filters === 'string' ? { collectionId: filters } : filters;
    const query = new URLSearchParams(
      Object.entries(values)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    return request<Task[]>(`/tasks${query.size ? `?${query}` : ''}`);
  },
  task: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (input: TaskInput) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  updateTask: (id: string, input: Partial<Omit<TaskInput, 'collectionId'>>) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  moveTask: (id: string, input: MoveTaskInput) =>
    request<Task>(`/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  completeTask: (id: string, reopen = false) =>
    request<Task>(`/tasks/${id}/${reopen ? 'reopen' : 'complete'}`, { method: 'POST' }),
  archiveTask: (id: string, restore = false) =>
    request<Task>(`/tasks/${id}/${restore ? 'restore' : 'archive'}`, { method: 'POST' }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  reorderTasks: (orderedIds: string[]) =>
    request('/tasks/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) }),
  dependencies: (id: string) => request<Task[]>(`/tasks/${id}/dependencies`),
  addDependency: (id: string, dependsOnTaskId: string) =>
    request(`/tasks/${id}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnTaskId }),
    }),
  removeDependency: (id: string, dependsOnTaskId: string) =>
    request<void>(`/tasks/${id}/dependencies/${dependsOnTaskId}`, { method: 'DELETE' }),
  createCollection: (input: CollectionInput) =>
    request<Collection>('/collections', { method: 'POST', body: JSON.stringify(input) }),
  updateCollection: (id: string, input: Partial<CollectionInput>) =>
    request<Collection>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  archiveCollection: (id: string) =>
    request<Collection>(`/collections/${id}/archive`, { method: 'POST' }),
  restoreCollection: (id: string) =>
    request<Collection>(`/collections/${id}/restore`, { method: 'POST' }),
  deleteCollection: (id: string) => request<void>(`/collections/${id}`, { method: 'DELETE' }),
  reorderCollections: (orderedIds: string[]) =>
    request('/collections/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) }),
  createPhase: (collectionId: string, input: PhaseInput) =>
    request<Phase>(`/collections/${collectionId}/phases`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updatePhase: (id: string, input: PhaseInput) =>
    request<Phase>(`/phases/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deletePhase: (id: string) => request<Phase>(`/phases/${id}`, { method: 'DELETE' }),
  reorderPhases: (collectionId: string, orderedIds: string[]) =>
    request(`/collections/${collectionId}/phases/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    }),
};
