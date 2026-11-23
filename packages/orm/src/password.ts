import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Enforced at credential-setting entry points; verification stays compatible with older hashes. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

const settings = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, settings, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length > MAX_PASSWORD_LENGTH)
    throw new Error(`Password must contain 1–${MAX_PASSWORD_LENGTH} characters`);
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  encoded: string | null | undefined
): Promise<boolean> {
  if (!encoded || !password || password.length > MAX_PASSWORD_LENGTH) return false;
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match) return false;
  return timingSafeEqual(await derive(password, match[1]), Buffer.from(match[2], 'hex'));
}
