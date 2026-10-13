import { isDeepStrictEqual } from 'node:util';
import { parseWorkspace } from '../../shared/domain';
import { defaultPreferences } from '../../shared/preferences';
import { registerSchema, profileUpdateSchema, workspaceUpdateSchema, invitationCreateSchema, userStatusSchema, type User, type WorkspaceSnapshot } from '../../shared/contracts';
import type { Dependencies } from './ports';
import { reject } from './errors';

const adminOnly = (user: User) => { if (user.role !== 'admin') reject('FORBIDDEN', '需要管理员权限'); };
export function createServices(d: Dependencies) {
  return {
    async authenticate(headers: Headers): Promise<User> {
      const id = await d.identity.sessionUserId(headers);
      if (!id) return reject('UNAUTHENTICATED', '请先登录');
      const user = await d.accounts.find(id);
      if (!user || user.disabled) return reject('UNAUTHENTICATED', '账户不可用，请重新登录或联系管理员');
      return user;
    },
    async register(input: unknown) {
      const body = registerSchema.parse(input);
      await d.invitations.consume(d.tokens.hash(body.token), async invite => {
        if (!invite || invite.email !== body.email || invite.redeemed_at || invite.revoked_at || new Date(invite.expires_at).getTime() <= d.now().getTime()) {
          return reject('INVALID_INPUT', '邀请无效、已使用或已过期，请联系管理员');
        }
        if (await d.accounts.emailExists(body.email)) reject('CONFLICT', '账户已存在，请登录或联系管理员');
        await d.identity.register({ email: body.email, name: body.name, password: body.password });
      });
      return { registered: true };
    },
    async profile(user: User) { return { user, preferences: await d.accounts.preferences(user.id) ?? defaultPreferences }; },
    async updateProfile(user: User, input: unknown) {
      const body = profileUpdateSchema.parse(input);
      await d.accounts.updateProfile(user.id, body.name, body.preferences);
      return { saved: true };
    },
    workspace(user: User) { return d.workspaces.get(user.id); },
    async saveWorkspace(user: User, input: unknown) {
      const body = workspaceUpdateSchema.parse(input);
      let data;
      try { data = parseWorkspace(JSON.stringify(body.data)); }
      catch { return reject('INVALID_INPUT', '题库结构无效，请检查备份格式'); }
      const snapshot: WorkspaceSnapshot = { revision: body.revision + 1, data };
      await d.workspaces.update(user.id, current => {
        if (current.revision !== body.revision) reject('CONFLICT', '题库已在其他设备更新，请备份当前改动后载入最新数据');
        for (const old of current.data.projects) {
          const next = data.projects.find(p => p.id === old.id);
          if (next && !isDeepStrictEqual(old.versions, next.versions.slice(0, old.versions.length))) {
            reject('INVALID_INPUT', '冻结版本不能修改或移除；请复制为新任务');
          }
        }
        return snapshot;
      });
      return { revision: snapshot.revision };
    },
    users(user: User) { adminOnly(user); return d.accounts.listUsers(); },
    async setUserStatus(user: User, id: string, input: unknown) {
      adminOnly(user);
      const { disabled } = userStatusSchema.parse(input);
      if (id === user.id) reject('INVALID_INPUT', '不能停用自己');
      if (!await d.accounts.setDisabled(id, disabled)) reject('NOT_FOUND', '普通用户不存在');
      return { saved: true };
    },
    invites(user: User) { adminOnly(user); return d.invitations.list(); },
    async invite(user: User, input: unknown) {
      adminOnly(user);
      const { email } = invitationCreateSchema.parse(input);
      if (await d.accounts.emailExists(email)) reject('CONFLICT', '该邮箱已注册');
      const { id, token } = d.tokens.generate();
      await d.invitations.create({ id, email, hash: d.tokens.hash(token), createdBy: user.id, expiresAt: new Date(d.now().getTime() + 7 * 86400000).toISOString() });
      return { id, url: `${d.publicOrigin}/#invite=${token}` };
    },
    async revokeInvite(user: User, id: string) {
      adminOnly(user);
      if (!await d.invitations.revoke(id)) reject('NOT_FOUND', '可撤销的邀请不存在');
      return { revoked: true };
    },
  };
}
export type Services = ReturnType<typeof createServices>;
