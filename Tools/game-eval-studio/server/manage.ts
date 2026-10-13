import { Pool } from 'pg';
import { readConfig } from './config';
import { createAuth } from './auth';
import { migrate } from './database';

const config = readConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });
try {
  const auth = createAuth(pool, config);
  const command = process.argv[2];
  if (command === 'migrate') {
    await migrate(pool, auth);
    console.log('数据库迁移完成');
  } else if (command === 'admin') {
    // Credentials arrive via stdin JSON, never argv, shell history or startup logs.
    let raw = '';
    for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4096) throw new Error('输入过长'); }
    const { z } = await import('zod');
    const body = z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(100), password: z.string().min(15).max(128) }).strict().parse(JSON.parse(raw));
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(827302)');
      const admins = await client.query('SELECT id FROM "user" WHERE role=\'admin\' LIMIT 1');
      if (admins.rowCount) throw new Error('管理员已初始化，不能重复创建');
      const result = await auth.api.signUpEmail({ body });
      await client.query('UPDATE "user" SET role=\'admin\' WHERE id=$1', [result.user.id]);
      console.log('首个管理员创建完成');
    } finally { await client.query('SELECT pg_advisory_unlock(827302)'); client.release(); }
  } else if (command === 'reset-password') {
    let raw = '';
    for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4096) throw new Error('输入过长'); }
    const { z } = await import('zod');
    const { hashPassword } = await import('better-auth/crypto');
    const body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(15).max(128) }).strict().parse(JSON.parse(raw));
    const password = await hashPassword(body.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id FROM "user" WHERE email=$1 FOR UPDATE', [body.email]);
      if (!result.rowCount) throw new Error('账户不存在');
      const updated = await client.query('UPDATE account SET password=$1,"updatedAt"=now() WHERE "userId"=$2 AND "providerId"=\'credential\'', [password, result.rows[0].id]);
      if (!updated.rowCount) throw new Error('密码账户不存在');
      await client.query('DELETE FROM session WHERE "userId"=$1', [result.rows[0].id]);
      await client.query('COMMIT');
      console.log('密码已重置，全部登录会话已撤销');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } else throw new Error('管理命令不存在');
} catch {
  console.error('管理命令失败，请检查配置、输入格式、数据库连接及管理员是否已存在。');
  process.exitCode = 1;
} finally { await pool.end(); }
