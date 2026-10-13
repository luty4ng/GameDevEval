// Ephemeral, loopback-only real PostgreSQL + API fixture. Never connect this to a production database.
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { migrate } from '../server/database';

const db = new EmbeddedPostgres({ databaseDir: resolve('test-results', `browser-pg-${randomUUID()}`), port: 55438, user: 'postgres', password: 'browser-test-only', persistent: false, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {} });
await db.initialise(); await db.start();
const pool = new Pool({ connectionString: 'postgres://postgres:browser-test-only@127.0.0.1:55438/postgres' });
const { app, auth } = await createApp(pool, { DATABASE_URL: '', AUTH_SECRET: 'browser-test-secret-at-least-32-characters', APP_URL: 'http://127.0.0.1:3000', NODE_ENV: 'test', PORT: 3000 }, { staticRoot: 'dist' });
await migrate(pool, auth);
const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.test', name: '管理员', password: 'browser-test-password-739' } });
await pool.query('UPDATE "user" SET role=\'admin\' WHERE id=$1', [admin.user.id]);
await app.listen({ port: 3000, host: '127.0.0.1' });
console.log('Browser fixture ready at http://127.0.0.1:3000');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await app.close(); await pool.end(); await db.stop(); process.exit(0); });
