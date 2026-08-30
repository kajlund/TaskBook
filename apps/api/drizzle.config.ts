import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
