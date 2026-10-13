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
  Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
  Saved: { type: 'object', required: ['saved'], properties: { saved: { const: true } } },
  Registered: { type: 'object', required: ['registered'], properties: { registered: { const: true } } },
  Revoked: { type: 'object', required: ['revoked'], properties: { revoked: { const: true } } },
  Revision: { type: 'object', required: ['revision'], properties: { revision: { type: 'integer', minimum: 1 } } },
  Users: { type: 'array', items: { allOf: [ref('User'), { type: 'object', required: ['createdAt'], properties: { createdAt: { type: 'string', format: 'date-time' } } }] } },
  Invite: { type: 'object', required: ['id', 'email', 'created_at', 'expires_at', 'redeemed_at', 'revoked_at'], properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, created_at: { type: 'string', format: 'date-time' }, expires_at: { type: 'string', format: 'date-time' }, redeemed_at: { type: ['string', 'null'], format: 'date-time' }, revoked_at: { type: ['string', 'null'], format: 'date-time' } } },
  Invites: { type: 'array', items: ref('Invite') },
  InviteCreated: { type: 'object', required: ['id', 'url'], properties: { id: { type: 'string', format: 'uuid' }, url: { type: 'string', format: 'uri' } } },
});
const workspaceInput = schemas.WorkspaceUpdate as { properties?: Record<string, unknown> };
if (workspaceInput.properties) workspaceInput.properties.data = ref('Workspace');
const content = (name: string) => ({ 'application/json': { schema: ref(name) } });
const operation = (summary: string, input?: string, authenticated = true, output?: string) => ({ summary, security: authenticated ? [{ sessionCookie: [] }] : [], ...(input ? { requestBody: { required: true, content: content(input) } } : {}), responses: { '200': { description: output ? 'Success' : 'Provider-specific authentication response; see Better Auth contract', ...(output ? { content: content(output) } : {}) }, ...Object.fromEntries(Object.entries({ 400: 'Invalid input', 401: 'Authentication required', 403: 'Permission or Origin rejected', 404: 'Resource not found', 409: 'Revision conflict or account already exists', 413: 'Request exceeds 10 MB', 429: 'Rate limit exceeded', 500: 'Service unavailable' }).map(([status, description]) => [status, { description, content: content('Error') }])) } });
const authOperation = (summary: string, input?: string, authenticated = true) => {
  const op = operation(summary, input, authenticated);
  return { ...op, responses: Object.fromEntries(Object.entries(op.responses).map(([status, response]) => [status, { description: `${response.description}; authentication provider may return its own error structure` }])) };
};
const document = { openapi: '3.1.0', info: { title: 'GameEval Studio API', version: '1.2.0' }, components: { schemas, securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Opaque HttpOnly session; Secure cookie name is provider-dependent. Do not store it in browser localStorage.' } } }, paths: {
  '/api/register': { post: operation('Redeem one email-bound invitation', 'Registration', false, 'Registered') },
  '/api/me': { get: operation('Current user and preferences', undefined, true, 'Profile') },
  '/api/preferences': { put: operation('Save name and evaluation defaults', 'ProfileUpdate', true, 'Saved') },
  '/api/workspace': { get: operation('Read own {revision,data}', undefined, true, 'WorkspaceSnapshot'), put: operation('Atomically save own workspace; returns {revision}', 'WorkspaceUpdate', true, 'Revision') },
  '/api/admin/users': { get: operation('List users; administrator required', undefined, true, 'Users') },
  '/api/admin/users/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], put: operation('Set member disabled status and revoke sessions', 'UserStatus', true, 'Saved') },
  '/api/admin/invites': { get: operation('List invite metadata without tokens', undefined, true, 'Invites'), post: operation('Create 7-day invitation; returns {id,url}', 'InviteCreate', true, 'InviteCreated') },
  '/api/admin/invites/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], delete: operation('Revoke an unredeemed invitation', undefined, true, 'Revoked') },
  '/api/auth/get-session': { get: authOperation('Session or null', undefined, false) },
  '/api/auth/sign-in/email': { post: authOperation('Email/password login with HttpOnly Cookie', 'Login', false) },
  '/api/auth/sign-out': { post: authOperation('Logout and clear session Cookie') },
  '/api/auth/change-password': { post: authOperation('Change password; supports revokeOtherSessions', 'ChangePassword') },
} };
await writeFile('docs/API.openapi.json', JSON.stringify(document, null, 2) + '\n');
console.log('API schema generated');
