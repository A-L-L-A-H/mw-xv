export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB

export function safeAttachmentName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255) return null;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) return null;
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('..')) return null;
  return trimmed;
}

export function encodedAttachmentName(name: string): string {
  return encodeURIComponent(name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
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
  { mimePrefixes: ['application/pdf'], bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mimePrefixes: ['application/zip'], bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/**
 * Validates that binary content matches the magic-byte signature for declared binary MIME types
 * (PNG, JPEG, GIF, WEBP, PDF, ZIP). Rejects spoofed files (e.g., HTML/script disguised as image/png).
 */
export function validateAttachmentMagicBytes(buffer: Buffer, mimeType: string | undefined): boolean {
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
