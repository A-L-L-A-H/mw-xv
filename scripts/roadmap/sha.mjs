/** Return true when `value` is a full 40-character lowercase hexadecimal Git SHA. */
export function isFullSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}
