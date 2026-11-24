export type RedactionResult = { text: string; redacted: boolean };

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi],
  ["GITHUB_TOKEN", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ["BEARER_TOKEN", /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi],
  ["API_SECRET", /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|token)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}["']?/gi],
  ["MODEL_KEY", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g],
  ["AWS_KEY", /\bAKIA[0-9A-Z]{16}\b/g],
  ["LOCAL_PATH", /\bfile:\/\/\/[^\s"'<>|]+/gi],
  ["LOCAL_PATH", /(?<![A-Za-z0-9:/])\/(?:[^\s"'<>|?#]+\/)*[^\s"'<>|?#]+/g],
  ["LOCAL_PATH", /(?<![A-Za-z0-9])[A-Za-z]:\\(?:[^\\\s"'<>|]+\\)*[^\\\s"'<>|]+/g],
  ["LOCAL_PATH", /(?<![:/])\\\\[^\\/\s]+[\\/][^\\/\s]+(?:[\\/][^\\/\s]+)*/g],
];

/** Replaces likely credentials without retaining a reversible copy of the match. */
export function redactSensitiveText(value: string): RedactionResult {
  let text = value;
  let redacted = false;
  for (const [label, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, () => {
      redacted = true;
      return `[REDACTED:${label}]`;
    });
  }
  return { text, redacted };
}
