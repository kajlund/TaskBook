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
export type Phase = { id: string; name: string; position: number };
export type Task = {
  id: string;
  name: string;
  phaseId: string | null;
  completedAt: string | null;
  dueDate: string | null;
};
export type CollectionInput = {
  name: string;
  description: string | null;
  structure: CollectionStructure;
  status?: CollectionStatus;
  startDate: string | null;
  targetEndDate: string | null;
};
const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
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
  tasks: (id: string) => request<Task[]>(`/tasks?collectionId=${encodeURIComponent(id)}`),
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
};
