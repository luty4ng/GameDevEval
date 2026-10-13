import { z } from 'zod';

export function readConfig(env = process.env) {
  const config = z.object({
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32).refine(value => !value.startsWith('replace-')),
    APP_URL: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    ACCESS_MODE: z.enum(['public', 'ssh']).default('public'),
  }).safeParse(env);
  if (!config.success) throw new Error(`服务配置无效：${config.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const url = new URL(config.data.APP_URL);
  if (url.origin !== config.data.APP_URL || url.username || url.password) throw new Error('APP_URL 必须是无路径的公开 origin');
  if (config.data.ACCESS_MODE === 'ssh' && (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')) throw new Error('SSH 模式仅允许 HTTP loopback origin');
  if (config.data.NODE_ENV === 'production' && config.data.ACCESS_MODE === 'public' && url.protocol !== 'https:') throw new Error('公网生产环境 APP_URL 必须使用 HTTPS');
  return config.data;
}
export type Config = ReturnType<typeof readConfig>;
