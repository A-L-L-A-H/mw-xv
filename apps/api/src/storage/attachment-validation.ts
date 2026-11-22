export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB

export const ATTACHMENT_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function safeAttachmentName(value: string | undefined): string | null {
  if (
    !value ||
    value.length > 255 ||
    value.includes('/') ||
    value.includes('\\') ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return null;
  const name = value.normalize('NFC').trim();
  if (!name || name === '.' || name === '..' || name.includes('..')) return null;
  return name;
}

export function encodedAttachmentName(name: string): string {
  return encodeURIComponent(name).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

interface MagicSignature {
  readonly mimePrefixes: readonly string[];
  readonly bytes: readonly number[];
  readonly offset?: number;
}

const MAGIC_SIGNATURES: readonly MagicSignature[] = [
  { mimePrefixes: ['image/png'], bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimePrefixes: ['image/jpeg', 'image/jpg'], bytes: [0xff, 0xd8, 0xff] },
  { mimePrefixes: ['image/gif'], bytes: [0x47, 0x49, 0x46, 0x38] },
  { mimePrefixes: ['image/webp'], bytes: [0x52, 0x49, 0x46, 0x46] },
  { mimePrefixes: ['application/pdf'], bytes: [0x25, 0x50, 0x44, 0x46] },
  { mimePrefixes: ['application/zip'], bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/**
 * Validates that binary content matches the magic-byte signature for declared binary MIME types
 * (PNG, JPEG, GIF, WEBP, PDF, ZIP). Rejects spoofed files (e.g., HTML/script disguised as image/png).
 */
export function validateAttachmentMagicBytes(
  buffer: Buffer,
  mimeType: string | undefined
): boolean {
  if (!mimeType) return true;
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const signature = MAGIC_SIGNATURES.find((sig) =>
    sig.mimePrefixes.some((prefix) => normalized === prefix)
  );
  if (!signature) return true;
  const offset = signature.offset ?? 0;
  if (buffer.length < offset + signature.bytes.length) return false;
  for (let i = 0; i < signature.bytes.length; i += 1) {
    if (buffer[offset + i] !== signature.bytes[i]) return false;
  }
  return true;
}
