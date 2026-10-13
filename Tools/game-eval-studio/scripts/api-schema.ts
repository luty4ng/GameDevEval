// Generate the wire protocol without importing any server/HTTP/database adapters.
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { registerSchema, profileUpdateSchema, workspaceUpdateSchema, invitationCreateSchema, userStatusSchema } from '../shared/contracts';
import { workspaceSchema } from '../shared/model';
import { preferencesSchema } from '../shared/preferences';
const schemas = Object.fromEntries(Object.entries({ Registration: registerSchema, ProfileUpdate: profileUpdateSchema, WorkspaceUpdate: workspaceUpdateSchema, InviteCreate: invitationCreateSchema, UserStatus: userStatusSchema, Workspace: workspaceSchema, Preferences: preferencesSchema }).map(([name, schema]) => [name, z.toJSONSchema(schema)]));
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
Object.assign(schemas, {
  User: { type: 'object', required: ['id', 'name', 'email', 'role', 'disabled'], properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', format: 'email' }, role: { type: 'string' }, disabled: { type: 'boolean' } } },
  Profile: { type: 'object', required: ['user', 'preferences'], properties: { user: ref('User'), preferences: ref('Preferences') } },
  WorkspaceSnapshot: { type: 'object', required: ['revision', 'data'], properties: { revision: { type: 'integer', minimum: 0 }, data: ref('Workspace') } },
  Login: z.toJSONSchema(z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).strict()),
  ChangePassword: z.toJSONSchema(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(15).max(128), revokeOtherSessions: z.boolean().optional() }).strict()),
});
const workspaceInput = schemas.WorkspaceUpdate as { properties?: Record<string, unknown> };
if (workspaceInput.properties) workspaceInput.properties.data = ref('Workspace');
const operation = (summary: string, input?: string, authenticated = true) => ({ summary, security: authenticated ? [{ sessionCookie: [] }] : [], ...(input ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${input}` } } } } } : {}), responses: { '200': { description: 'Success; see documented response contracts' }, '400': { description: 'Invalid input' }, '401': { description: 'Authentication required' }, '403': { description: 'Permission or Origin rejected' }, '409': { description: 'Revision conflict or account already exists' } } });
const document = { openapi: '3.1.0', info: { title: 'GameEval Studio API', version: '1.2.0' }, components: { schemas, securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Opaque HttpOnly session; Secure cookie name is provider-dependent. Do not store it in browser localStorage.' } } }, paths: {
  '/api/register': { post: operation('Redeem one email-bound invitation', 'Registration', false) },
  '/api/me': { get: operation('Current user and preferences') },
  '/api/preferences': { put: operation('Save name and evaluation defaults', 'ProfileUpdate') },
  '/api/workspace': { get: operation('Read own {revision,data}'), put: operation('Atomically save own workspace; returns {revision}', 'WorkspaceUpdate') },
  '/api/admin/users': { get: operation('List users; administrator required') },
  '/api/admin/users/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], put: operation('Set member disabled status and revoke sessions', 'UserStatus') },
  '/api/admin/invites': { get: operation('List invite metadata without tokens'), post: operation('Create 7-day invitation; returns {id,url}', 'InviteCreate') },
  '/api/admin/invites/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], delete: operation('Revoke an unredeemed invitation') },
  '/api/auth/get-session': { get: operation('Session or null', undefined, false) },
  '/api/auth/sign-in/email': { post: operation('Email/password login with HttpOnly Cookie', 'Login', false) },
  '/api/auth/sign-out': { post: operation('Logout and clear session Cookie') },
  '/api/auth/change-password': { post: operation('Change password; supports revokeOtherSessions', 'ChangePassword') },
} };
await writeFile('docs/API.openapi.json', JSON.stringify(document, null, 2) + '\n');
console.log('API schema generated');
