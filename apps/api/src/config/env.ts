import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const env = schema.parse(process.env);
