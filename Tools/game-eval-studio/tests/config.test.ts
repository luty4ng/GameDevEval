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
