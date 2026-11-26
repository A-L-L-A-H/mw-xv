import { createHash } from "node:crypto";

const REDACTION_MASK = "[REDACTED]";

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

const BUILTIN_REDACTION_RULES: readonly RedactionRule[] = [
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: `Bearer ${REDACTION_MASK}` },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: REDACTION_MASK },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: REDACTION_MASK },
  { pattern: /\bgho_[A-Za-z0-9]{20,}\b/g, replacement: REDACTION_MASK },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: REDACTION_MASK },
  {
    pattern: /\b(?:postgres|postgresql):\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/g,
    replacement: REDACTION_MASK,
  },
  {
    pattern: /\b(MW_SETUP_TOKEN|JWT_SECRET|PASSWORD|SECRET)\s*[=:]\s*[^\s"',;]+/gi,
    replacement: `$1=${REDACTION_MASK}`,
  },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: `-----BEGIN PRIVATE KEY-----\n${REDACTION_MASK}\n-----END PRIVATE KEY-----`,
  },
];

export interface RedactionResult {
  text: string;
  redacted: boolean;
}

/**
 * Scrub known secret shapes (and any caller-supplied `knownSecrets`) from
 * arbitrary tool output. Never emit unredacted secrets downstream.
 */
export function redactSensitiveText(input: string, knownSecrets?: readonly string[]): RedactionResult {
  let text = input;
  let redacted = false;
  for (const rule of BUILTIN_REDACTION_RULES) {
    const next = text.replace(rule.pattern, rule.replacement);
    if (next !== text) {
      redacted = true;
      text = next;
    }
  }
  if (knownSecrets) {
    for (const secret of knownSecrets) {
      if (!secret) {
        continue;
      }
      if (text.includes(secret)) {
        redacted = true;
        text = text.split(secret).join(REDACTION_MASK);
      }
    }
  }
  return { text, redacted };
}

/** Hex SHA-256 of a UTF-8 string. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Deterministic JSON serializer: object keys sorted lexicographically at
 * every depth, no whitespace.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",");
  return `{${body}}`;
}
