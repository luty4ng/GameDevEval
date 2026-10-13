import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createApp } from '../server/app';
import { migrate } from '../server/database';
import { demoProject } from '../src/templates';
import { freezeVersion } from '../src/domain';
import { defaultPreferences } from '../src/preferences';

const origin = 'http://localhost:3000';
const password = 'test-only-long-password-739';
const db = new EmbeddedPostgres({ databaseDir: resolve('test-results', `pg-${randomUUID()}`), port: 55437, user: 'postgres', password: 'local-test-only', persistent: false, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {} });
let pool: Pool;
let runtime: Awaited<ReturnType<typeof createApp>>;
let adminCookie: string;
let memberCookie: string;
let memberId: string;
let memberToken: string;
let address = 1;
const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, cookie?: string, requestOrigin: string | undefined = origin) => runtime.app.inject({
  method, url, payload: body === undefined ? undefined : JSON.stringify(body), remoteAddress: `127.0.1.${address++}`, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(requestOrigin ? { origin: requestOrigin } : {}), ...(cookie ? { cookie } : {}) },
});
const cookies = (response: Awaited<ReturnType<typeof request>>) => response.cookies.map(c => `${c.name}=${c.value}`).join('; ');
const invite = async (email: string) => {
  const result = await request('POST', '/api/admin/invites', { email }, adminCookie);
  expect(result.statusCode).toBe(200);
  return { id: result.json().id as string, token: new URL(result.json().url).hash.slice('#invite='.length) };
};
const registration = (token: string, email: string) => ({ token, email, name: '测试专家', password });
const login = (email: string, value = password) => request('POST', '/api/auth/sign-in/email', { email, password: value });

beforeAll(async () => {
  await db.initialise(); await db.start();
  pool = new Pool({ connectionString: 'postgres://postgres:local-test-only@127.0.0.1:55437/postgres', max: 10 });
  runtime = await createApp(pool, { DATABASE_URL: '', AUTH_SECRET: 'integration-test-secret-at-least-32-chars', APP_URL: origin, NODE_ENV: 'test', ACCESS_MODE: 'public', PORT: 3000 });
  await migrate(pool, runtime.auth);
  await migrate(pool, runtime.auth); // migrations are repeatable
  const admin = await runtime.auth.api.signUpEmail({ body: { email: 'admin@example.test', name: '管理员', password } });
  await pool.query('UPDATE "user" SET role=\'admin\' WHERE id=$1', [admin.user.id]);
  const signedIn = await login('admin@example.test');
  expect(signedIn.statusCode).toBe(200);
  adminCookie = cookies(signedIn);
}, 120000);
afterAll(async () => { await runtime?.app.close(); await pool?.end(); await db.stop(); }, 30000);

describe('PostgreSQL account and workspace integration', () => {
  it('requires real sessions and blocks uninvited or privileged signup', async () => {
    expect((await request('GET', '/api/workspace')).statusCode).toBe(401);
    expect((await runtime.app.inject({ method: 'GET', url: '/api/admin/users', headers: { 'x-user-id': 'admin', 'x-role': 'admin' } })).statusCode).toBe(401);
    expect((await request('POST', '/api/auth/sign-up/email', registration('0'.repeat(64), 'bad@example.test'))).statusCode).toBe(404);
    expect((await request('POST', '/api/register', registration('0'.repeat(64), 'bad@example.test'))).statusCode).toBe(400);
    const result = await invite('member@example.test'); memberToken = result.token;
    expect((await request('POST', '/api/register', { ...registration(memberToken, 'member@example.test'), role: 'admin' })).statusCode).toBe(400);
    expect((await request('POST', '/api/register', registration(memberToken, 'other@example.test'))).statusCode).toBe(400);
  });
  it('redeems an invitation once, stores a password hash, and logs in with HttpOnly cookies', async () => {
    const results = await Promise.all([request('POST', '/api/register', registration(memberToken, 'member@example.test')), request('POST', '/api/register', registration(memberToken, 'member@example.test'))]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 400]);
    const signIn = await login('member@example.test');
    expect(signIn.statusCode).toBe(200);
    expect(String(signIn.headers['set-cookie'])).toContain('HttpOnly');
    memberCookie = cookies(signIn); memberId = signIn.json().user.id;
    const stored = await pool.query('SELECT password FROM account WHERE "userId"=$1', [memberId]);
    expect(stored.rows[0].password).not.toBe(password);
    expect(stored.rows[0].password.length).toBeGreaterThan(40);
    const token = await pool.query('SELECT token_hash FROM app_invite WHERE email=$1', ['member@example.test']);
    expect(token.rows[0].token_hash).not.toBe(memberToken);
    expect((await request('GET', '/api/admin/users', undefined, memberCookie)).statusCode).toBe(403);
    expect((await login('member@example.test', 'wrong-long-test-password')).statusCode).toBe(401);
  });
  it('rejects expired and revoked invitations', async () => {
    const expired = await invite('expired@example.test');
    await pool.query('UPDATE app_invite SET expires_at=now()-interval \'1 second\' WHERE id=$1', [expired.id]);
    expect((await request('POST', '/api/register', registration(expired.token, 'expired@example.test'))).statusCode).toBe(400);
    const revoked = await invite('revoked@example.test');
    expect((await request('DELETE', `/api/admin/invites/${revoked.id}`, undefined, adminCookie)).statusCode).toBe(200);
    expect((await request('POST', '/api/register', registration(revoked.token, 'revoked@example.test'))).statusCode).toBe(400);
  });
  it('isolates account workspaces and prevents client identity overrides', async () => {
    const data = { schemaVersion: 1, projects: [demoProject()] };
    expect((await request('PUT', '/api/workspace', { revision: 0, data }, adminCookie)).statusCode).toBe(200);
    const member = await request('GET', '/api/workspace', undefined, memberCookie);
    expect(member.json().data.projects).toHaveLength(0);
    expect((await request('PUT', '/api/workspace', { revision: 0, data, userId: 'admin' }, memberCookie)).statusCode).toBe(400);
    expect((await request('GET', '/api/workspace?userId=admin', undefined, memberCookie)).json().data.projects).toHaveLength(0);
  });
  it('persists personal defaults and validates numeric boundaries', async () => {
    const preferences = { ...defaultPreferences, engine: 'Godot', engineVersion: '4.5', timeBudget: 60 };
    expect((await request('PUT', '/api/preferences', { name: '专家 A', preferences }, memberCookie)).statusCode).toBe(200);
    expect((await request('GET', '/api/me', undefined, memberCookie)).json().preferences).toEqual(preferences);
    expect((await request('GET', '/api/me', undefined, adminCookie)).json().preferences).toEqual(defaultPreferences);
    expect((await request('PUT', '/api/preferences', { name: '专家 A', preferences: { ...preferences, timeBudget: -1 } }, memberCookie)).statusCode).toBe(400);
  });
  it('resolves simultaneous saves with one success and one conflict', async () => {
    const payload = { revision: 0, data: { schemaVersion: 1, projects: [demoProject()] } };
    const results = await Promise.all([request('PUT', '/api/workspace', payload, memberCookie), request('PUT', '/api/workspace', payload, memberCookie)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await request('GET', '/api/workspace', undefined, memberCookie)).json().revision).toBe(1);
  });
  it('keeps frozen versions immutable after a JSONB roundtrip', async () => {
    const data = (await request('GET', '/api/workspace', undefined, memberCookie)).json().data;
    const project = data.projects[0];
    project.task.baseline = 'repo@abcd1234'; project.task.scene = 'Assets/Main.unity'; project.task.hardware = 'Windows RTX 3060 16GB 1080p';
    data.projects[0] = freezeVersion(project, '专家 A', '校准完成');
    expect((await request('PUT', '/api/workspace', { revision: 1, data }, memberCookie)).statusCode).toBe(200);
    const roundtrip = (await request('GET', '/api/workspace', undefined, memberCookie)).json();
    roundtrip.data.projects[0].task.title = '新草稿';
    expect((await request('PUT', '/api/workspace', { revision: 2, data: roundtrip.data }, memberCookie)).statusCode).toBe(200);
    roundtrip.data.projects[0].versions[0].task.title = '篡改历史';
    expect((await request('PUT', '/api/workspace', { revision: 3, data: roundtrip.data }, memberCookie)).statusCode).toBe(400);
  });
  it('requires same-origin writes and never caches private responses', async () => {
    expect((await request('PUT', '/api/preferences', {}, memberCookie, 'https://evil.example')).statusCode).toBe(403);
    const noOrigin = await runtime.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: memberCookie }, payload: {} });
    expect(noOrigin.statusCode).toBe(403);
    expect((await request('GET', '/api/workspace', undefined, memberCookie)).headers['cache-control']).toBe('no-store');
  });
  it('changes passwords and revokes other devices', async () => {
    const second = cookies(await login('member@example.test'));
    const result = await request('POST', '/api/auth/change-password', { currentPassword: password, newPassword: `${password}-changed`, revokeOtherSessions: true }, memberCookie);
    expect(result.statusCode).toBe(200);
    memberCookie = cookies(result) || memberCookie;
    expect((await request('GET', '/api/workspace', undefined, second)).statusCode).toBe(401);
    expect((await login('member@example.test')).statusCode).toBe(401);
    const newLogin = await login('member@example.test', `${password}-changed`);
    expect(newLogin.statusCode).toBe(200); memberCookie = cookies(newLogin);
  });
  it('disables users immediately, revokes sessions and supports re-enabling', async () => {
    expect((await request('PUT', `/api/admin/users/${memberId}`, { disabled: true }, adminCookie)).statusCode).toBe(200);
    expect((await request('GET', '/api/workspace', undefined, memberCookie)).statusCode).toBe(401);
    expect((await login('member@example.test', `${password}-changed`)).statusCode).toBe(403);
    expect((await request('PUT', `/api/admin/users/${memberId}`, { disabled: false }, adminCookie)).statusCode).toBe(200);
    const signIn = await login('member@example.test', `${password}-changed`);
    expect(signIn.statusCode).toBe(200); memberCookie = cookies(signIn);
    expect((await request('POST', '/api/auth/sign-out', {}, memberCookie)).statusCode).toBe(200);
    expect((await request('GET', '/api/workspace', undefined, memberCookie)).statusCode).toBe(401);
  });
  it('uses Secure production cookies and rate-limits login using the actual peer IP', async () => {
    const secure = await createApp(pool, { DATABASE_URL: '', AUTH_SECRET: 'production-test-secret-at-least-32-chars', APP_URL: 'https://gameeval.example.test', NODE_ENV: 'production', ACCESS_MODE: 'public', PORT: 3000 });
    try {
      const result = await secure.app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: 'https://gameeval.example.test' }, payload: { email: 'admin@example.test', password } });
      expect(result.statusCode).toBe(200);
      expect(String(result.headers['set-cookie'])).toContain('Secure');
      expect(String(result.headers['set-cookie'])).toContain('HttpOnly');
    } finally { await secure.app.close(); }
    for (let n = 0; n < 11; n++) {
      const result = await runtime.app.inject({ method: 'POST', url: '/api/auth/sign-in/email', remoteAddress: '127.0.2.50', headers: { origin, 'x-app-client-ip': `127.0.3.${n}` }, payload: { email: 'missing@example.test', password } });
      expect(result.statusCode).toBe(n === 10 ? 429 : 401);
    }
  });
  it('supports stdin-only password recovery and refuses a second initial administrator', async () => {
    const run = (command: string, body: unknown) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'server/manage.ts', command], { env: { ...process.env, DATABASE_URL: 'postgres://postgres:local-test-only@127.0.0.1:55437/postgres', AUTH_SECRET: 'integration-test-secret-at-least-32-chars', APP_URL: origin, NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      child.on('error', reject); child.on('exit', code => resolve({ code, output }));
      child.stdin.end(JSON.stringify(body));
    });
    const existing = cookies(await login('member@example.test', `${password}-changed`));
    const recoveryPassword = `${password}-recovered`;
    const reset = await run('reset-password', { email: 'member@example.test', password: recoveryPassword });
    expect(reset.code).toBe(0); expect(reset.output).not.toContain(recoveryPassword);
    expect((await request('GET', '/api/workspace', undefined, existing)).statusCode).toBe(401);
    expect((await login('member@example.test', recoveryPassword)).statusCode).toBe(200);
    const secondAdmin = await run('admin', { email: 'second-admin@example.test', name: '管理员 2', password });
    expect(secondAdmin.code).toBe(1);
    expect((await pool.query('SELECT id FROM "user" WHERE email=$1', ['second-admin@example.test'])).rowCount).toBe(0);
  });
  it('supports production SSH access with HttpOnly cookies and exact loopback Origin checks', async () => {
    const ssh = await createApp(pool, { DATABASE_URL: '', AUTH_SECRET: 'ssh-test-secret-at-least-32-characters', APP_URL: 'http://127.0.0.1:3000', NODE_ENV: 'production', ACCESS_MODE: 'ssh', PORT: 3000 });
    try {
      const result = await ssh.app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: 'http://127.0.0.1:3000' }, payload: { email: 'admin@example.test', password } });
      expect(result.statusCode).toBe(200);
      expect(String(result.headers['set-cookie'])).toContain('HttpOnly');
      expect(String(result.headers['set-cookie'])).not.toContain('; Secure');
      const foreign = await ssh.app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: 'http://example.test' }, payload: { email: 'admin@example.test', password } });
      expect(foreign.statusCode).toBe(403);
    } finally { await ssh.app.close(); }
  });
});
