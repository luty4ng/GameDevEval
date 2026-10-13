import { Pool } from 'pg';
import { z } from 'zod';
import { readConfig } from './config';
import { createAuth } from './infrastructure/better-auth';
import { migrate } from './infrastructure/postgres/migrations';
import { initializeAdministrator, recoverPassword } from './infrastructure/postgres/maintenance';
import { emailSchema } from '../shared/contracts';

const config = readConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });
async function input() {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4096) throw new Error('输入过长'); }
  return JSON.parse(raw);
}
try {
  const auth = createAuth(pool, config);
  const command = process.argv[2];
  const credentials = z.object({ email: emailSchema, password: z.string().min(15).max(128) });
  if (command === 'migrate') {
    await migrate(pool, auth);
    console.log('数据库迁移完成');
  } else if (command === 'admin') {
    await initializeAdministrator(pool, auth, credentials.extend({ name: z.string().trim().min(1).max(100) }).strict().parse(await input()));
    console.log('首个管理员创建完成');
  } else if (command === 'reset-password') {
    await recoverPassword(pool, credentials.strict().parse(await input()));
    console.log('密码已重置，全部登录会话已撤销');
  } else throw new Error('管理命令不存在');
} catch {
  console.error('管理命令失败，请检查配置、输入格式、数据库连接及管理员是否已存在。');
  process.exitCode = 1;
} finally { await pool.end(); }
