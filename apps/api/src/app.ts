import { randomUUID } from 'node:crypto';

import { cors } from 'hono/cors';
import { Hono } from 'hono';
import pino from 'pino';
import { zValidator } from '@hono/zod-validator';

import {
  createCollectionSchema,
  collectionListQuerySchema,
  createPhaseSchema,
  createTaskSchema,
  dependencySchema,
  reorderSchema,
  updateCollectionSchema,
  updatePhaseSchema,
  updateTaskSchema,
  uuidSchema,
} from '@waymark/contracts';
import { db } from './db/client.js';
import { DomainError } from './errors/domain-error.js';
import { WaymarkService } from './services/waymark-service.js';
import { env } from './config/env.js';

type AppEnv = { Variables: { requestId: string } };
const logger = pino();
const service = new WaymarkService(db);

export const app = new Hono<AppEnv>();

app.use('*', cors({ origin: env.WEB_ORIGIN }));
app.use('*', async (c, next) => {
  const id = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
  logger.info(
    { requestId: id, method: c.req.method, path: c.req.path, status: c.res.status },
    'request',
  );
});

const ok = <T>(c: any, data: T, status = 200) => c.json({ data }, status);
const id = (c: any, key: string) => uuidSchema.parse(c.req.param(key));
app.get('/api/health', (c) => ok(c, { status: 'ok' }));
app.get('/api/collections', zValidator('query', collectionListQuerySchema), async (c) => {
  const query = c.req.valid('query');
  return ok(
    c,
    await service.collections({
      ...(query.status && { status: query.status }),
      includeArchived: query.includeArchived === 'true',
    }),
  );
});
app.post('/api/collections', zValidator('json', createCollectionSchema), async (c) =>
  ok(c, await service.createCollection(c.req.valid('json')), 201),
);

app.get('/api/collections/:collectionId', async (c) =>
  ok(c, await service.collection(id(c, 'collectionId'))),
);

app.patch('/api/collections/:collectionId', zValidator('json', updateCollectionSchema), async (c) =>
  ok(c, await service.updateCollection(id(c, 'collectionId'), c.req.valid('json'))),
);

app.post('/api/collections/reorder', zValidator('json', reorderSchema), async (c) =>
  ok(c, await service.reorderCollections(c.req.valid('json').orderedIds)),
);
for (const [path, restore] of [
  ['archive', false],
  ['restore', true],
] as const)
  app.post(`/api/collections/:collectionId/${path}`, async (c) =>
    ok(c, await service.archiveCollection(id(c, 'collectionId'), restore)),
  );
app.delete('/api/collections/:collectionId', async (c) => {
  await service.deleteCollection(id(c, 'collectionId'));
  return c.body(null, 204);
});
app.get('/api/collections/:collectionId/phases', async (c) =>
  ok(c, await service.listPhases(id(c, 'collectionId'))),
);

app.post(
  '/api/collections/:collectionId/phases',
  zValidator('json', createPhaseSchema),
  async (c) => ok(c, await service.createPhase(id(c, 'collectionId'), c.req.valid('json')), 201),
);
app.patch('/api/phases/:phaseId', zValidator('json', updatePhaseSchema), async (c) =>
  ok(c, await service.updatePhase(id(c, 'phaseId'), c.req.valid('json'))),
);

app.delete('/api/phases/:phaseId', async (c) => ok(c, await service.deletePhase(id(c, 'phaseId'))));

app.post(
  '/api/collections/:collectionId/phases/reorder',
  zValidator('json', reorderSchema),
  async (c) =>
    ok(c, await service.reorderPhases(id(c, 'collectionId'), c.req.valid('json').orderedIds)),
);

app.get('/api/tasks', async (c) => {
  const collectionId = c.req.query('collectionId'),
    phaseId = c.req.query('phaseId'),
    completed = c.req.query('completed');
  return ok(
    c,
    await service.listTasks({
      ...(collectionId && { collectionId }),
      ...(phaseId && { phaseId }),
      unassigned: c.req.query('unassigned') === 'true',
      ...(completed !== undefined && { completed: completed === 'true' }),
      includeArchived: c.req.query('includeArchived') === 'true',
    }),
  );
});

app.post('/api/tasks', zValidator('json', createTaskSchema), async (c) =>
  ok(c, await service.createTask(c.req.valid('json')), 201),
);

app.get('/api/tasks/:taskId', async (c) => ok(c, await service.task(id(c, 'taskId'))));

app.patch('/api/tasks/:taskId', zValidator('json', updateTaskSchema), async (c) =>
  ok(c, await service.updateTask(id(c, 'taskId'), c.req.valid('json'))),
);

app.post('/api/tasks/reorder', zValidator('json', reorderSchema), async (c) =>
  ok(c, await service.reorderTasks(c.req.valid('json').orderedIds)),
);

app.post('/api/tasks/:taskId/move', async (c) => {
  const body = await c.req.json<{ phaseId: string | null; position: number }>();
  return ok(c, await service.moveTask(id(c, 'taskId'), body.phaseId, body.position));
});

for (const [path, reopen] of [
  ['complete', false],
  ['reopen', true],
] as const)
  app.post(`/api/tasks/:taskId/${path}`, async (c) =>
    ok(c, await service.completeTask(id(c, 'taskId'), reopen)),
  );

for (const [path, restore] of [
  ['archive', false],
  ['restore', true],
] as const)
  app.post(`/api/tasks/:taskId/${path}`, async (c) =>
    ok(c, await service.archiveTask(id(c, 'taskId'), restore)),
  );

app.get('/api/tasks/:taskId/dependencies', async (c) =>
  ok(c, await service.dependencies(id(c, 'taskId'))),
);

app.post('/api/tasks/:taskId/dependencies', zValidator('json', dependencySchema), async (c) =>
  ok(c, await service.addDependency(id(c, 'taskId'), c.req.valid('json').dependsOnTaskId), 201),
);

app.delete('/api/tasks/:taskId/dependencies/:dependsOnTaskId', async (c) => {
  await service.removeDependency(id(c, 'taskId'), id(c, 'dependsOnTaskId'));
  return c.body(null, 204);
});

app.notFound((c) =>
  c.json(
    { error: { code: 'NOT_FOUND', message: 'Route not found', requestId: c.get('requestId') } },
    404,
  ),
);

app.onError((error, c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  if (error instanceof DomainError)
    return c.json(
      { error: { code: error.code, message: error.message, details: error.details, requestId } },
      error.status,
    );
  logger.error({ err: error, requestId }, 'unhandled error');
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId } },
    500,
  );
});
