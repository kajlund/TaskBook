import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/client.js';
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  console.log(`TaskBook API listening on http://localhost:${info.port}`),
);
const shutdown = async () => {
  server.close();
  await pool.end();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
