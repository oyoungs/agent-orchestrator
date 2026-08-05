import { describe, expect, it } from "vitest";
import { formatContextSize } from "../src/cli/chat.ts";

describe("formatContextSize", () => {
  it("formats bytes and kilo units", () => {
    expect(formatContextSize(0)).toBe("0B");
    expect(formatContextSize(765)).toBe("765B");
    expect(formatContextSize(11_200)).toBe("11.2k");
    expect(formatContextSize(12_000)).toBe("12.0k");
  });
});
