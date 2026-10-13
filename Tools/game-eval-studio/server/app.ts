// Composition root: swapping adapters happens here, not in business policies.
import type { Pool } from 'pg';
import type { Config } from './config';
import { createAuth, identityProvider } from './infrastructure/better-auth';
import { postgresRepositories } from './infrastructure/postgres/repositories';
import { invitationTokens } from './infrastructure/tokens';
import { createHttpApp } from './transport/fastify';

export async function createApp(pool: Pool, config: Config, options: { staticRoot?: string } = {}) {
  const auth = createAuth(pool, config);
  const app = await createHttpApp({
    ...postgresRepositories(pool), identity: identityProvider(auth), tokens: invitationTokens,
    now: () => new Date(), publicOrigin: config.APP_URL,
    healthy: async () => { await pool.query('SELECT 1'); },
  }, { production: config.NODE_ENV === 'production' && config.ACCESS_MODE !== 'ssh', ...options });
  return { app, auth };
}
