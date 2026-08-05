const SECRET_KEY_RE = /\b(key|token|secret|password|passwd|authorization|auth|api[_-]?key|cookie)\b/i;
const SECRET_VALUE_RE = /(sk-[A-Za-z0-9_-]{8,}|tp-[A-Za-z0-9_-]{8,}|gho_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/g;

export function redactValue(value: unknown, key: string): unknown {
  if (typeof value === "string" && SECRET_KEY_RE.test(key)) return "***REDACTED***";
  return value;
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactPayload(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item !== null && typeof item === "object" ? redactPayload(item as Record<string, unknown>) : redactValue(item, k),
      );
    } else {
      out[k] = redactValue(v, k);
    }
  }
  return out;
}

export function redactString(input: string): string {
  return input.replace(SECRET_VALUE_RE, "***REDACTED***");
}
