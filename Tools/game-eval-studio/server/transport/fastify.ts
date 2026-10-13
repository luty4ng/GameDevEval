import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApplicationError, reject, type ErrorCode } from '../application/errors';
import { createServices } from '../application/services';
import type { Dependencies } from '../application/ports';
import type { User } from '../../shared/contracts';

const statuses: Record<ErrorCode, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 };
export async function createHttpApp(d: Dependencies, config: { production: boolean; staticRoot?: string }) {
  const services = createServices(d);
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024, logger: false, trustProxy: config.production ? (_address, hop) => hop === 0 : false });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApplicationError) return reply.code(statuses[error.code]).send({ error: error.message });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '输入格式或范围不正确' });
    const status = Number((error as { statusCode?: number }).statusCode);
    if (status === 400) return reply.code(400).send({ error: '输入格式不正确' });
    if (status === 413) return reply.code(413).send({ error: '内容不能超过 10 MB' });
    if (status === 429) return reply.code(429).send({ error: '请求过于频繁，请稍后重试' });
    return reply.code(500).send({ error: '服务暂时不可用，请稍后重试' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== d.publicOrigin) reject('FORBIDDEN', '请求来源不允许');
    }
  });
  app.get('/health', async (_request, reply) => {
    try { await d.healthy(); return { status: 'ok' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', handler: async (request, reply) => {
    const path = request.url.split('?')[0];
    const allowed = request.method === 'GET' ? ['/api/auth/get-session'] : ['/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/change-password'];
    if (!allowed.includes(path)) reject('NOT_FOUND', '接口不存在');
    const headers = requestHeaders(request.headers);
    headers.set('x-app-client-ip', request.ip);
    const response = await d.identity.handle(new Request(new URL(request.url, d.publicOrigin), {
      method: request.method, headers, body: request.method === 'GET' ? undefined : JSON.stringify(request.body ?? {}),
    }));
    reply.code(response.status);
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    return reply.send(await response.text());
  } });
  app.post('/api/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, request => services.register(request.body));
  app.register(async secured => {
    secured.addHook('preHandler', async request => { request.user = await services.authenticate(requestHeaders(request.headers)); });
    secured.get('/api/me', request => services.profile(request.user));
    secured.put('/api/preferences', request => services.updateProfile(request.user, request.body));
    secured.get('/api/workspace', request => services.workspace(request.user));
    secured.put('/api/workspace', request => services.saveWorkspace(request.user, request.body));
    secured.get('/api/admin/users', request => services.users(request.user));
    secured.put('/api/admin/users/:id', request => {
      const { id } = z.object({ id: z.string().min(1).max(100) }).parse(request.params);
      return services.setUserStatus(request.user, id, request.body);
    });
    secured.get('/api/admin/invites', request => services.invites(request.user));
    secured.post('/api/admin/invites', request => services.invite(request.user, request.body));
    secured.delete('/api/admin/invites/:id', request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      return services.revokeInvite(request.user, id);
    });
  });
  if (config.staticRoot) {
    await app.register(staticFiles, { root: resolve(config.staticRoot) });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在' }) : reply.sendFile('index.html'));
  }
  return app;
}
function requestHeaders(values: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}
declare module 'fastify' { interface FastifyRequest { user: User } }
