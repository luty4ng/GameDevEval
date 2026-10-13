import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { InvitationTokens } from '../application/ports';
export const invitationTokens: InvitationTokens = {
  generate: () => ({ id: randomUUID(), token: randomBytes(32).toString('hex') }),
  hash: token => createHash('sha256').update(token).digest('hex'),
};
