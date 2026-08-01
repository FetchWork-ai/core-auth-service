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
  OTP_SALT_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(32).default('default-key-for-development-only-32b'),
  // OAuth
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  GITHUB_REDIRECT_URI: z.string().url(),

  // SMTP Configuration
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

// 3. Now when Zod checks process.env, the variables will actually be there!
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const config = _env.data;