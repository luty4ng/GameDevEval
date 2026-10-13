import { betterAuth, APIError } from 'better-auth';
import type { Pool } from 'pg';
import type { Config } from '../config';

export function createAuth(pool: Pool, config: Config) {
  return betterAuth({
    logger: { disabled: true },
    database: pool,
    secret: config.AUTH_SECRET,
    baseURL: config.APP_URL,
    trustedOrigins: [config.APP_URL],
    emailAndPassword: { enabled: true, minPasswordLength: 15, maxPasswordLength: 128, autoSignIn: false },
    user: { additionalFields: {
      role: { type: 'string', defaultValue: 'member', input: false },
      disabled: { type: 'boolean', defaultValue: false, input: false },
    } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 300 },
    advanced: { useSecureCookies: config.NODE_ENV === 'production' && config.ACCESS_MODE !== 'ssh', ipAddress: { ipAddressHeaders: ['x-app-client-ip'] } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 10 } } },
    databaseHooks: {
      session: { create: { before: async session => {
        const result = await pool.query('SELECT disabled FROM "user" WHERE id = $1', [session.userId]);
        if (!result.rows[0] || result.rows[0].disabled) throw new APIError('FORBIDDEN', { message: '账户不可用，请联系管理员' });
        return { data: session };
      } } },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;

export function identityProvider(auth: Auth): import('../application/ports').IdentityProvider {
  return {
    sessionUserId: async headers => (await auth.api.getSession({ headers }))?.user.id ?? null,
    register: async body => { await auth.api.signUpEmail({ body }); },
    handle: request => auth.handler(request),
  };
}
