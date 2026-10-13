// Stable wire contracts shared by browser, HTTP adapter and application services.
import { z } from 'zod';
import { preferencesSchema, type Preferences } from './preferences';
import type { Workspace } from './model';

export type User = { id: string; name: string; email: string; role: string; disabled: boolean };
export type WorkspaceSnapshot = { revision: number; data: Workspace };
export type Profile = { user: User; preferences: Preferences };
export type Invite = { id: string; email: string; created_at: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null };
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const registerSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), email: emailSchema, name: z.string().trim().min(1).max(100), password: z.string().min(15).max(128) }).strict();
export const profileUpdateSchema = z.object({ name: z.string().trim().min(1).max(100), preferences: preferencesSchema }).strict();
export const workspaceUpdateSchema = z.object({ revision: z.number().int().nonnegative(), data: z.unknown() }).strict();
export const invitationCreateSchema = z.object({ email: emailSchema }).strict();
export const userStatusSchema = z.object({ disabled: z.boolean() }).strict();
