import type { Pool, PoolClient } from 'pg';
import type { AccountRepository, InvitationRepository, WorkspaceRepository } from '../../application/ports';
import type { Invite } from '../../../shared/contracts';

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
const iso = (date: Date | string) => new Date(date).toISOString();
const inviteDTO = (row: Record<string, unknown>): Invite => ({ id: String(row.id), email: String(row.email), created_at: iso(row.created_at as Date), expires_at: iso(row.expires_at as Date), redeemed_at: row.redeemed_at ? iso(row.redeemed_at as Date) : null, revoked_at: row.revoked_at ? iso(row.revoked_at as Date) : null });

export function postgresRepositories(pool: Pool): { workspaces: WorkspaceRepository; accounts: AccountRepository; invitations: InvitationRepository } {
  return {
    workspaces: {
      async get(userId) {
        const result = await pool.query('SELECT revision,data FROM app_workspace WHERE user_id=$1', [userId]);
        return result.rows[0] ?? { revision: 0, data: { schemaVersion: 1, projects: [] } };
      },
      async update(userId, mutate) {
        await transaction(pool, async client => {
          await client.query('INSERT INTO app_workspace(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
          const result = await client.query('SELECT revision,data FROM app_workspace WHERE user_id=$1 FOR UPDATE', [userId]);
          const snapshot = mutate(result.rows[0]);
          await client.query('UPDATE app_workspace SET revision=$1,data=$2,updated_at=now() WHERE user_id=$3', [snapshot.revision, snapshot.data, userId]);
        });
      },
    },
    accounts: {
      async find(id) { return (await pool.query('SELECT id,name,email,role,disabled FROM "user" WHERE id=$1', [id])).rows[0] ?? null; },
      async emailExists(email) { return !!(await pool.query('SELECT id FROM "user" WHERE email=$1', [email])).rowCount; },
      async preferences(id) { return (await pool.query('SELECT data FROM app_preferences WHERE user_id=$1', [id])).rows[0]?.data ?? null; },
      async updateProfile(id, name, preferences) {
        await transaction(pool, async client => {
          await client.query('UPDATE "user" SET name=$1,"updatedAt"=now() WHERE id=$2', [name, id]);
          await client.query('INSERT INTO app_preferences(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data', [id, preferences]);
        });
      },
      async listUsers() { return (await pool.query('SELECT id,name,email,role,disabled,"createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT 1000')).rows.map(row => ({ ...row, createdAt: iso(row.createdAt) })); },
      async setDisabled(id, disabled) {
        return transaction(pool, async client => {
          const result = await client.query('UPDATE "user" SET disabled=$1,"updatedAt"=now() WHERE id=$2 AND role<>\'admin\' RETURNING id', [disabled, id]);
          if (!result.rowCount) return false;
          if (disabled) await client.query('DELETE FROM session WHERE "userId"=$1', [id]);
          return true;
        });
      },
    },
    invitations: {
      async consume(hash, redeem) {
        await transaction(pool, async client => {
          const result = await client.query('SELECT * FROM app_invite WHERE token_hash=$1 FOR UPDATE', [hash]);
          const invite = result.rows[0] ? inviteDTO(result.rows[0]) : null;
          await redeem(invite);
          if (invite) await client.query('UPDATE app_invite SET redeemed_at=now() WHERE id=$1', [invite.id]);
        });
      },
      async create(invite) { await pool.query('INSERT INTO app_invite(id,email,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5)', [invite.id, invite.email, invite.hash, invite.createdBy, invite.expiresAt]); },
      async list() { return (await pool.query('SELECT id,email,created_at,expires_at,redeemed_at,revoked_at FROM app_invite ORDER BY created_at DESC LIMIT 1000')).rows.map(inviteDTO); },
      async revoke(id) { return !!(await pool.query('UPDATE app_invite SET revoked_at=now() WHERE id=$1 AND redeemed_at IS NULL RETURNING id', [id])).rowCount; },
    },
  };
}
