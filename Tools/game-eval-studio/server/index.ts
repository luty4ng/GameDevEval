import { Pool } from 'pg';
import { readConfig } from './config';
import { createApp } from './app';

const config = readConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
const { app } = await createApp(pool, config, { staticRoot: 'dist' });
await app.listen({ port: config.PORT, host: '0.0.0.0' });
console.log(`GameEval Studio listening on port ${config.PORT}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
