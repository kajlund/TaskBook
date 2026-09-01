import { beforeEach, describe, expect, it, vi } from 'vitest';

const { moveTask } = vi.hoisted(() => ({ moveTask: vi.fn() }));

vi.mock('../src/services/taskbook-service.js', () => ({
  TaskBookService: class {
    moveTask = moveTask;
  },
}));

const { app } = await import('../src/app.js');

const taskId = '11111111-1111-4111-8111-111111111111';
const collectionId = '22222222-2222-4222-8222-222222222222';
const phaseId = '33333333-3333-4333-8333-333333333333';
const input = {
  destinationCollectionId: collectionId,
  destinationPhaseId: phaseId,
  name: 'Moved task',
};

const request = (body: unknown = input, id = taskId) =>
  app.request(`/api/tasks/${id}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('task move API', () => {
  beforeEach(() => moveTask.mockReset());

  it('passes destination context and edits to the transactional service', async () => {
    const moved = { id: taskId, collectionId, phaseId, name: 'Moved task' };
    moveTask.mockResolvedValue(moved);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: moved });
    expect(moveTask).toHaveBeenCalledWith(taskId, input);
  });

  it.each([
    [{ destinationCollectionId: 'bad', destinationPhaseId: null }, 'body'],
    [input, 'id'],
  ])('returns 400 for malformed %s', async (body, malformed) => {
    const response = await request(body, malformed === 'id' ? 'bad' : taskId);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toMatch(/VALIDATION_ERROR|INVALID_ID/);
  });
});
