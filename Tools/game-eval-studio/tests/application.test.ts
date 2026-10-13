import { it, expect } from 'vitest';
import { createServices } from '../server/application/services';
import { ApplicationError } from '../server/application/errors';
import type { Dependencies } from '../server/application/ports';
import type { User, Invite, WorkspaceSnapshot } from '../shared/contracts';
import { defaultPreferences } from '../shared/preferences';
import { demoProject } from '../src/templates';

function portableApplication() {
  const users = new Map<string, User>([['admin', { id: 'admin', email: 'admin@example.test', name: 'Admin', role: 'admin', disabled: false }]]);
  const workspaces = new Map<string, WorkspaceSnapshot>();
  const invitations = new Map<string, Invite>();
  const preferences = new Map();
  const token = 'a'.repeat(64);
  const dependencies: Dependencies = {
    identity: {
      sessionUserId: async headers => headers.get('x-test-user'),
      register: async body => { users.set(body.email, { ...body, id: body.email, role: 'member', disabled: false }); },
      handle: async () => new Response(null, { status: 404 }),
    },
    workspaces: {
      get: async id => workspaces.get(id) ?? { revision: 0, data: { schemaVersion: 1, projects: [] } },
      update: async (id, mutate) => { const current = workspaces.get(id) ?? { revision: 0, data: { schemaVersion: 1 as const, projects: [] } }; const next = mutate(structuredClone(current)); workspaces.set(id, next); },
    },
    accounts: {
      find: async id => users.get(id) ?? null,
      emailExists: async email => [...users.values()].some(user => user.email === email),
      preferences: async id => preferences.get(id) ?? null,
      updateProfile: async (id, name, prefs) => { users.get(id)!.name = name; preferences.set(id, prefs); },
      listUsers: async () => [...users.values()].map(user => ({ ...user, createdAt: '2026-10-13T00:00:00Z' })),
      setDisabled: async (id, disabled) => { const user = users.get(id); if (!user || user.role === 'admin') return false; user.disabled = disabled; return true; },
    },
    invitations: {
      consume: async (hash, redeem) => { const invite = invitations.get(hash) ?? null; await redeem(invite); if (invite) invite.redeemed_at = dependencies.now().toISOString(); },
      create: async input => { invitations.set(input.hash, { id: input.id, email: input.email, created_at: dependencies.now().toISOString(), expires_at: input.expiresAt, redeemed_at: null, revoked_at: null }); },
      list: async () => [...invitations.values()],
      revoke: async id => { const invite = [...invitations.values()].find(invite => invite.id === id); if (!invite || invite.redeemed_at) return false; invite.revoked_at = dependencies.now().toISOString(); return true; },
    },
    tokens: { generate: () => ({ token, id: 'portable-invite' }), hash: value => `test-hash:${value}` },
    now: () => new Date('2026-10-13T00:00:00Z'), publicOrigin: 'https://example.test', healthy: async () => {},
  };
  return { services: createServices(dependencies), users, token };
}
it('runs invite, personal settings and workspace workflows without Fastify, pg or Better Auth', async () => {
  const { services, users, token } = portableApplication();
  const admin = users.get('admin')!;
  expect(await services.invite(admin, { email: 'expert@example.test' })).toEqual({ id: 'portable-invite', url: `https://example.test/#invite=${token}` });
  await services.register({ token, email: 'expert@example.test', name: 'Expert', password: 'portable-test-password-long' });
  const expert = await services.authenticate(new Headers({ 'x-test-user': 'expert@example.test' }));
  await services.updateProfile(expert, { name: 'Expert A', preferences: { ...defaultPreferences, engine: 'Godot' } });
  expect((await services.profile(expert)).preferences.engine).toBe('Godot');
  await services.saveWorkspace(expert, { revision: 0, data: { schemaVersion: 1, projects: [demoProject()] } });
  expect((await services.workspace(expert)).revision).toBe(1);
  expect((await services.workspace(admin)).data.projects).toHaveLength(0);
  await expect(services.saveWorkspace(expert, { revision: 0, data: { schemaVersion: 1, projects: [] } })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await services.workspace(expert)).data.projects).toHaveLength(1);
  await expect(services.register({ token, email: expert.email, name: 'Retry', password: 'portable-test-password-long' })).rejects.toBeInstanceOf(ApplicationError);
});
it('enforces administrator access and disabled-user rejection in business services themselves', async () => {
  const { services, users } = portableApplication();
  const member: User = { id: 'member', email: 'member@example.test', name: 'Member', role: 'member', disabled: false };
  users.set(member.id, member);
  await expect(services.invite(member, { email: 'other@example.test' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(() => services.users(member)).toThrow(ApplicationError);
  await services.setUserStatus(users.get('admin')!, member.id, { disabled: true });
  await expect(services.authenticate(new Headers({ 'x-test-user': 'member' }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(services.authenticate(new Headers())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});
