import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

// Stored as `scrypt:<N>:<r>:<p>:<salt>:<hash>`, the last two base64url. No `$`, so the value
// survives shell and Docker Compose variable interpolation unchanged.
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * 1024 * 1024;

interface ParsedHash {
  cost: number;
  blockSize: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
}

function parse(stored: string): ParsedHash | undefined {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return undefined;
  const [cost, blockSize, parallelism] = parts.slice(1, 4).map(Number);
  if (![cost, blockSize, parallelism].every((n) => Number.isInteger(n) && n > 0)) return undefined;
  // What scrypt itself accepts: a power-of-two cost, and memory within what we allow it.
  if ((cost & (cost - 1)) !== 0 || cost < 2 || 128 * cost * blockSize > MAX_MEMORY)
    return undefined;
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');
  if (salt.length === 0 || hash.length === 0) return undefined;
  return { cost, blockSize, parallelism, salt, hash };
}

/** Whether `stored` is a well-formed hash produced by {@link hashPassword}. */
export function isPasswordHash(stored: string): boolean {
  return parse(stored) !== undefined;
}

/** Hashes a password for `BANKAPP_PASSWORD_HASH`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join(':');
}

/** Checks a password against a stored hash in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const derived = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      parsed.salt,
      parsed.hash.length,
      { N: parsed.cost, r: parsed.blockSize, p: parsed.parallelism, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
  return timingSafeEqual(derived, parsed.hash);
}
