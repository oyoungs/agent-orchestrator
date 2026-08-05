import { describe, expect, it } from "vitest";
import { renderMarkdown, sanitize, terminalLines } from "../src/cli/markdown.ts";

const RESET = "\x1b[0m";

describe("markdown renderer", () => {
  it("renders headings with ANSI styling and no raw markers", () => {
    const out = renderMarkdown("# 标题");
    expect(out).toContain("\x1b[1m");
    expect(out).toContain("标题");
    expect(out).not.toContain("#");
    expect(out).toContain(RESET);
  });

  it("renders inline bold/code and strips markers", () => {
    const out = renderMarkdown("这是 **加粗** 和 `code`");
    expect(out).toContain("\x1b[1m加粗\x1b[0m");
    expect(out).not.toContain("**");
    expect(out).not.toContain("`");
  });

  it("renders fenced code blocks", () => {
    const out = renderMarkdown("```ts\nlet x = 1;\n```");
    expect(out).toContain("let x = 1;");
    expect(out).toContain("\x1b[48;5;236m");
    expect(out).not.toContain("```");
  });

  it("renders lists and links", () => {
    const out = renderMarkdown("- a\n- b\n\n[链接](https://example.com)");
    expect(out).toContain("- a");
    expect(out).toContain("- b");
    expect(out).toContain("\x1b[4m"); // underline for link
    expect(out).toContain("https://example.com");
  });

  it("sanitizes injected escape sequences", () => {
    expect(sanitize("a\x1b[31mred")).not.toContain("\x1b");
    expect(sanitize("a\x1b[31mred")).toBe("ared");
  });

  it("estimates terminal lines with wrapping", () => {
    expect(terminalLines("abc\ndef", 10)).toBe(2);
    expect(terminalLines("a".repeat(25), 10)).toBe(3);
    expect(terminalLines("\x1b[1mabc\x1b[0m", 10)).toBe(1);
  });
});
