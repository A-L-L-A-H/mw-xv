import crypto from 'crypto';

// Password hashing with Node's built-in scrypt (no external dependency).
// Parameters follow the OWASP minimum: N = 2^17, r = 8, p = 1.
// Current format: `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`.
// Legacy two-part hashes remain verifiable for existing accounts.
const KEYLEN = 64;
const SALT_BYTES = 16;
const COST = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, KEYLEN, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return false;

  let settings: crypto.ScryptOptions = COST;
  let saltHex: string;
  let hashHex: string;
  if (parts.length === 5) {
    const [N, r, p] = parts.slice(1, 4).map(Number);
    if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
    settings = { N, r, p, maxmem: COST.maxmem };
    saltHex = parts[3];
    hashHex = parts[4];
  } else if (parts.length === 3) {
    // Legacy vendor hash: Node default scrypt parameters, no stored metadata.
    settings = { maxmem: COST.maxmem };
    saltHex = parts[1];
    hashHex = parts[2];
  } else {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length !== SALT_BYTES || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, settings);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
