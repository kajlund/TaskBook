import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';
await migrate(db, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) });
await pool.end();
console.log('TaskBook migrations applied');
