import { getMigrations } from 'better-auth/db/migration';
import type { Pool } from 'pg';
import type { Auth } from './auth';

// Run explicitly before serving traffic. Never change schema in a request handler.
export async function migrate(pool: Pool, auth: Auth) {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(827301)');
    const migration = await getMigrations(auth.options);
    await migration.runMigrations();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_workspace (
        user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        revision integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL DEFAULT '{"schemaVersion":1,"projects":[]}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS app_preferences (
        user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_invite (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        token_hash text UNIQUE NOT NULL,
        created_by text NOT NULL REFERENCES "user"(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        redeemed_at timestamptz,
        revoked_at timestamptz
      );
    `);
  } finally {
    await lock.query('SELECT pg_advisory_unlock(827301)');
    lock.release();
  }
}
