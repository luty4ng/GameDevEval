import { expect, it } from 'vitest';
import { readConfig } from '../server/config';
const base = { DATABASE_URL: 'postgres://app:test@localhost/app', AUTH_SECRET: 'test-only-independent-secret-32characters', APP_URL: 'https://gameeval.example.test', NODE_ENV: 'production' };
it('enforces HTTPS, exact public origins and non-placeholder secrets', () => {
  expect(readConfig(base).APP_URL).toBe(base.APP_URL);
  expect(() => readConfig({ ...base, APP_URL: 'http://gameeval.example.test' })).toThrow();
  expect(() => readConfig({ ...base, APP_URL: `${base.APP_URL}/path` })).toThrow();
  expect(() => readConfig({ ...base, AUTH_SECRET: 'replace-with-independent-random-hex' })).toThrow();
  expect(() => readConfig({ ...base, DATABASE_URL: '' })).toThrow();
});
it('permits an explicit SSH-only production origin and rejects non-loopback HTTP', () => {
  expect(readConfig({ ...base, ACCESS_MODE: 'ssh', APP_URL: 'http://127.0.0.1:3000' }).ACCESS_MODE).toBe('ssh');
  expect(() => readConfig({ ...base, ACCESS_MODE: 'ssh', APP_URL: 'http://example.test:3000' })).toThrow();
  expect(() => readConfig({ ...base, ACCESS_MODE: 'ssh', APP_URL: 'https://127.0.0.1:3000' })).toThrow();
});
