import { describe, expect, it } from "vitest";
import { parseAnalysis } from "../src/router/analyzer.ts";

describe("parseAnalysis", () => {
  it("parses plain JSON", () => {
    const result = parseAnalysis('{"type":"fix","complexity":"high","capabilities":["tool_calling"],"reason":"需要改代码"}');
    expect(result?.type).toBe("fix");
    expect(result?.complexity).toBe("high");
    expect(result?.capabilities).toEqual(["tool_calling"]);
  });

  it("tolerates code fences and surrounding text", () => {
    const raw = '```json\n{"type":"test","complexity":"low","capabilities":[],"reason":"x"}\n```';
    expect(parseAnalysis(raw)?.type).toBe("test");
    expect(parseAnalysis(`前文\n${raw}\n后文`)?.type).toBe("test");
  });

  it("returns null for invalid output", () => {
    expect(parseAnalysis("对不起，我无法分析")).toBeNull();
    expect(parseAnalysis('{"type":"fix"}')).toBeNull();
    expect(parseAnalysis("{not-json}")).toBeNull();
  });
});
