import { describe, expect, it } from "vitest";
import { redactPayload, redactString } from "../src/security/redact.ts";

describe("redact", () => {
  it("masks secret-keyed fields recursively", () => {
    const out = redactPayload({
      apiKey: "sk-1234567890abcdef",
      nested: { token: "abc", name: "keep" },
      list: [{ password: "x" }],
    });
    expect(out.apiKey).toBe("***REDACTED***");
    expect((out.nested as Record<string, unknown>).token).toBe("***REDACTED***");
    expect((out.nested as Record<string, unknown>).name).toBe("keep");
    expect((out.list as Array<Record<string, unknown>>)[0]?.password).toBe("***REDACTED***");
  });

  it("masks raw secret patterns in strings", () => {
    const out = redactString("key=sk-abcdefghijkl1234567890 tp-abcdefghijkl1234567890");
    expect(out).not.toContain("sk-abcdefghijkl1234567890");
    expect(out).not.toContain("tp-abcdefghijkl1234567890");
  });
});
