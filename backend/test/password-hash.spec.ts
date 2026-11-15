import { hashPassword, isPasswordHash, verifyPassword } from '../src/auth/password-hash';

describe('password hashing', () => {
  const hash = hashPassword('hunter2');

  it('accepts the password it hashed and nothing else', async () => {
    expect(await verifyPassword('hunter2', hash)).toBe(true);
    expect(await verifyPassword('hunter3', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('never contains the password and salts every hash', () => {
    expect(hash).not.toContain('hunter2');
    expect(hashPassword('hunter2')).not.toBe(hash);
  });

  it('uses no `$`, which shells and Docker Compose would interpolate', () => {
    expect(hash).not.toContain('$');
  });

  it('recognises well-formed hashes only', () => {
    expect(isPasswordHash(hash)).toBe(true);
    expect(isPasswordHash('hunter2')).toBe(false);
    expect(isPasswordHash('scrypt:1:2:3:x')).toBe(false);
    expect(isPasswordHash('scrypt:a:8:1:abc:def')).toBe(false);
    // scrypt cannot run with a cost that is not a power of two, or one needing too much memory.
    expect(isPasswordHash('scrypt:3:8:1:abc:def')).toBe(false);
    expect(isPasswordHash('scrypt:4294967296:8:1:abc:def')).toBe(false);
  });

  it('refuses everything against a malformed stored hash', async () => {
    expect(await verifyPassword('hunter2', 'garbage')).toBe(false);
  });
});
