// Operator-only adapter. Auth table names and password format remain isolated here.
import type { Pool } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import type { Auth } from '../better-auth';

export async function initializeAdministrator(pool: Pool, auth: Auth, body: { email: string; name: string; password: string }) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(827302)');
    const admins = await client.query('SELECT id FROM "user" WHERE role=\'admin\' LIMIT 1');
    if (admins.rowCount) throw new Error('管理员已初始化');
    const result = await auth.api.signUpEmail({ body });
    await client.query('UPDATE "user" SET role=\'admin\' WHERE id=$1', [result.user.id]);
  } finally { await client.query('SELECT pg_advisory_unlock(827302)'); client.release(); }
}
export async function recoverPassword(pool: Pool, body: { email: string; password: string }) {
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
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
