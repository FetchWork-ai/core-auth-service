import { z } from 'zod';
// 1. Import dotenv
import * as dotenv from 'dotenv';

// 2. Tell dotenv to read your .env file and load it into process.env
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  KAFKA_BROKERS: z.string().transform((str) => str.split(',')),
  JWT_SECRET: z.string().min(32),
});

// 3. Now when Zod checks process.env, the variables will actually be there!
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const config = _env.data;