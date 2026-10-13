import type { User, Invite, WorkspaceSnapshot } from '../../shared/contracts';
import type { Preferences } from '../../shared/preferences';

// No Fastify, pg, Better Auth or React types cross this boundary.
export interface IdentityProvider {
  sessionUserId(headers: Headers): Promise<string | null>;
  register(input: { email: string; name: string; password: string }): Promise<void>;
  handle(request: Request): Promise<Response>;
}
export interface WorkspaceRepository {
  get(userId: string): Promise<WorkspaceSnapshot>;
  update(userId: string, mutate: (current: WorkspaceSnapshot) => WorkspaceSnapshot): Promise<void>;
}
export interface AccountRepository {
  find(id: string): Promise<User | null>;
  emailExists(email: string): Promise<boolean>;
  preferences(id: string): Promise<Preferences | null>;
  updateProfile(id: string, name: string, preferences: Preferences): Promise<void>;
  listUsers(): Promise<(User & { createdAt: string })[]>;
  setDisabled(id: string, disabled: boolean): Promise<boolean>;
}
export interface InvitationRepository {
  // Implementation must serialize consumption and only mark redeemed after the callback succeeds.
  consume(hash: string, redeem: (invite: Invite | null) => Promise<void>): Promise<void>;
  create(invite: { id: string; email: string; hash: string; createdBy: string; expiresAt: string }): Promise<void>;
  list(): Promise<Invite[]>;
  revoke(id: string): Promise<boolean>;
}
export interface InvitationTokens {
  generate(): { id: string; token: string };
  hash(token: string): string;
}
export type Dependencies = {
  identity: IdentityProvider;
  workspaces: WorkspaceRepository;
  accounts: AccountRepository;
  invitations: InvitationRepository;
  tokens: InvitationTokens;
  now: () => Date;
  publicOrigin: string;
  healthy: () => Promise<void>;
};
