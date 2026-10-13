import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Pool } from 'pg';
import { parseWorkspace } from '../src/domain';
import { defaultPreferences, preferencesSchema } from '../src/preferences';
import { createAuth } from './auth';
import type { Config } from './config';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const registerSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/), email: emailSchema,
  name: z.string().trim().min(1).max(100), password: z.string().min(15).max(128),
}).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
class HttpError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

export async function createApp(pool: Pool, config: Config, options: { staticRoot?: string } = {}) {
  const auth = createAuth(pool, config);
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024, logger: false, trustProxy: config.NODE_ENV === 'production' ? (_address, hop) => hop === 0 : false });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '输入格式或范围不正确' });
    const status = Number((error as { statusCode?: number }).statusCode);
    if (status === 400) return reply.code(400).send({ error: '输入格式不正确' });
    if (status === 413) return reply.code(413).send({ error: '内容不能超过 10 MB' });
    if (status === 429) return reply.code(429).send({ error: '请求过于频繁，请稍后重试' });
    // Never serialize SQL, connection strings, auth bodies or exception messages to clients/logs.
    return reply.code(500).send({ error: '服务暂时不可用，请稍后重试' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== config.APP_URL) {
        fail(403, '请求来源不允许');
      }
    }
  });
  app.get('/health', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ok' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });

  // Only expose the auth operations used by the product. Signup is exclusively through invitations.
  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', handler: async (request, reply) => {
    const path = request.url.split('?')[0];
    const allowed = request.method === 'GET' ? ['/api/auth/get-session'] : [
      '/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/change-password',
    ];
    if (!allowed.includes(path)) fail(404, '接口不存在');
    const headers = fromNodeHeaders(request.headers);
    headers.set('x-app-client-ip', request.ip);
    const response = await auth.handler(new Request(new URL(request.url, config.APP_URL), {
      method: request.method, headers,
      body: request.method === 'GET' ? undefined : JSON.stringify(request.body ?? {}),
    }));
    reply.code(response.status);
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    return reply.send(await response.text());
  } });

  app.post('/api/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async request => {
    const body = registerSchema.parse(request.body);
    const client = await pool.connect();
    // Lock one invite across the auth call. Requests cannot redeem a token twice.
    const tokenHash = hash(body.token);
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT * FROM app_invite WHERE token_hash=$1 FOR UPDATE`, [tokenHash]);
      const invite = result.rows[0];
      if (!invite || invite.email !== body.email || invite.redeemed_at || invite.revoked_at || new Date(invite.expires_at).getTime() <= Date.now()) {
        fail(400, '邀请无效、已使用或已过期，请联系管理员');
      }
      const existing = await client.query('SELECT id FROM "user" WHERE email=$1', [body.email]);
      if (existing.rowCount) fail(409, '账户已存在，请登录或联系管理员');
      // No client-supplied role, user ID or cookies reach this internal registration call.
      await auth.api.signUpEmail({ body: { email: body.email, name: body.name, password: body.password } });
      await client.query('UPDATE app_invite SET redeemed_at=now() WHERE id=$1', [invite.id]);
      await client.query('COMMIT');
      return { registered: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  app.register(async secured => {
    secured.addHook('preHandler', async request => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session) fail(401, '请先登录');
      const user = await pool.query('SELECT id, name, email, role, disabled FROM "user" WHERE id=$1', [session!.user.id]);
      if (!user.rows[0] || user.rows[0].disabled) fail(401, '账户不可用，请重新登录或联系管理员');
      request.user = user.rows[0];
    });
    secured.get('/api/me', async request => {
      const result = await pool.query('SELECT data FROM app_preferences WHERE user_id=$1', [request.user.id]);
      return { user: request.user, preferences: result.rows[0]?.data ?? defaultPreferences };
    });
    secured.put('/api/preferences', async request => {
      const body = z.object({ name: z.string().trim().min(1).max(100), preferences: preferencesSchema }).strict().parse(request.body);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE "user" SET name=$1, "updatedAt"=now() WHERE id=$2', [body.name, request.user.id]);
        await client.query('INSERT INTO app_preferences (user_id,data) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data', [request.user.id, body.preferences]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      return { saved: true };
    });
    secured.get('/api/workspace', async request => {
      const result = await pool.query('SELECT revision,data FROM app_workspace WHERE user_id=$1', [request.user.id]);
      return result.rows[0] ?? { revision: 0, data: { schemaVersion: 1, projects: [] } };
    });
    secured.put('/api/workspace', async request => {
      const body = z.object({ revision: z.number().int().nonnegative(), data: z.unknown() }).strict().parse(request.body);
      let data;
      try { data = parseWorkspace(JSON.stringify(body.data)); }
      catch { return fail(400, '题库结构无效，请检查备份格式'); }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO app_workspace(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [request.user.id]);
        const result = await client.query('SELECT revision,data FROM app_workspace WHERE user_id=$1 FOR UPDATE', [request.user.id]);
        const current = result.rows[0];
        if (current.revision !== body.revision) fail(409, '题库已在其他设备更新，请备份当前改动后载入最新数据');
        for (const old of current.data.projects) {
          const next = data.projects.find(p => p.id === old.id);
          if (next && !isDeepStrictEqual(old.versions, next.versions.slice(0, old.versions.length))) {
            fail(400, '冻结版本不能修改或移除；请复制为新任务');
          }
        }
        await client.query('UPDATE app_workspace SET revision=revision+1,data=$1,updated_at=now() WHERE user_id=$2', [data, request.user.id]);
        await client.query('COMMIT');
        return { revision: body.revision + 1 };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    });
    await secured.register(async admin => {
      admin.addHook('preHandler', async request => { if (request.user.role !== 'admin') fail(403, '需要管理员权限'); });
      admin.get('/api/admin/users', async () => {
        const result = await pool.query('SELECT id,name,email,role,disabled,"createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT 1000');
        return result.rows;
      });
      admin.put('/api/admin/users/:id', async request => {
        const { id } = z.object({ id: z.string().min(1).max(100) }).parse(request.params);
        const { disabled } = z.object({ disabled: z.boolean() }).strict().parse(request.body);
        if (id === request.user.id) fail(400, '不能停用自己');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await client.query('UPDATE "user" SET disabled=$1,"updatedAt"=now() WHERE id=$2 AND role<>\'admin\' RETURNING id', [disabled, id]);
          if (!result.rowCount) fail(404, '普通用户不存在');
          if (disabled) await client.query('DELETE FROM session WHERE "userId"=$1', [id]);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
        return { saved: true };
      });
      admin.get('/api/admin/invites', async () => {
        const result = await pool.query('SELECT id,email,created_at,expires_at,redeemed_at,revoked_at FROM app_invite ORDER BY created_at DESC LIMIT 1000');
        return result.rows;
      });
      admin.post('/api/admin/invites', async request => {
        const body = z.object({ email: emailSchema }).strict().parse(request.body);
        if ((await pool.query('SELECT id FROM "user" WHERE email=$1', [body.email])).rowCount) fail(409, '该邮箱已注册');
        const token = randomBytes(32).toString('hex');
        const id = randomUUID();
        await pool.query('INSERT INTO app_invite(id,email,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval \'7 days\')', [id, body.email, hash(token), request.user.id]);
        return { id, url: `${config.APP_URL}/#invite=${token}` };
      });
      admin.delete('/api/admin/invites/:id', async request => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const result = await pool.query('UPDATE app_invite SET revoked_at=now() WHERE id=$1 AND redeemed_at IS NULL RETURNING id', [id]);
        if (!result.rowCount) fail(404, '可撤销的邀请不存在');
        return { revoked: true };
      });
    });
  });
  if (options.staticRoot) {
    await app.register(staticFiles, { root: resolve(options.staticRoot) });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在' }) : reply.sendFile('index.html'));
  }
  return { app, auth };
}

declare module 'fastify' {
  interface FastifyRequest { user: { id: string; name: string; email: string; role: string; disabled: boolean } }
}
