import { lexer } from "marked";
import type { Token, Tokens } from "marked";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const STRIKE = "\x1b[9m";
const fg = (n: number): string => `\x1b[38;5;${n}m`;
const bg = (n: number): string => `\x1b[48;5;${n}m`;

const C = {
  h1: fg(214),
  h2: fg(215),
  h3: fg(117),
  code: fg(186),
  codeBg: bg(236),
  link: fg(75),
  quote: fg(245),
  hr: fg(240),
  em: fg(223),
  del: fg(240),
  table: fg(252),
  html: fg(245),
};

interface InlineToken {
  type: string;
  text?: string;
  href?: string;
  tokens?: InlineToken[];
  raw?: string;
}

const ANSI_SEQ_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const ANSI_M_RE = /\x1b\[[0-9;]*m/g;
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** 过滤模型输出中的转义序列与控制字符，防止终端注入 */
export function sanitize(text: string): string {
  return text.replace(ANSI_SEQ_RE, "").replace(CTRL_RE, "");
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_M_RE, "");
}

export function renderMarkdown(text: string): string {
  const tokens = lexer(prepareMarkdown(text), { gfm: true, breaks: true });
  const blocks = tokens.map((t) => renderBlock(t, 0)).filter((b) => b !== "");
  const body = blocks.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return body ? `${body}\n` : "";
}

/** 宽容预处理：模型常输出转义（\\*\\*）或带空格（** xx **）的强调语法，统一转为标准形式 */
function prepareMarkdown(text: string): string {
  return text
    .replace(/\\([*_#`~>|])/g, "$1")
    .replace(/(\*\*)[ \t]+([^*\n]+?)[ \t]+(\*\*)/g, "**$2**");
}

function renderBlock(token: Token, indent: number): string {
  const pad = " ".repeat(indent);
  switch (token.type) {
    case "space":
      return "";
    case "heading": {
      const label = renderInline((token.tokens ?? []) as InlineToken[]);
      const color = token.depth <= 1 ? C.h1 : token.depth === 2 ? C.h2 : C.h3;
      return `${pad}${BOLD}${color}${label}${RESET}`;
    }
    case "paragraph":
      return `${pad}${renderInline((token.tokens ?? []) as InlineToken[])}`;
    case "text":
      return `${pad}${renderInline(
        (((token as { tokens?: InlineToken[] }).tokens ?? [{ type: "text", text: (token as { text?: string }).text ?? "" }]) as InlineToken[]),
      )}`;
    case "code": {
      const lang = token.lang ? `${DIM}[${sanitize(token.lang)}]${RESET}\n` : "";
      const body = token.text
        .split("\n")
        .map((line: string) => `${pad}${C.codeBg}${C.code} ${line}${RESET}`)
        .join("\n");
      return `${lang}${body}`;
    }
    case "blockquote": {
      const inner = (token.tokens ?? []).map((t: Token) => renderBlock(t, 0)).join("\n");
      return inner
        .split("\n")
        .map((line: string) => `${pad}${DIM}│${RESET} ${line}`)
        .join("\n");
    }
    case "list": {
      return token.items
        .map((item: Tokens.ListItem, i: number) => {
          const marker = token.ordered ? `${(token.start ?? 1) + i}. ` : "- ";
          const body = item.tokens.map((t: Token) => renderBlock(t, 0)).join("\n");
          return body
            .split("\n")
            .map((line: string, idx: number) =>
              idx === 0 ? `${pad}${marker}${line}` : `${pad}${" ".repeat(marker.length)}${line}`,
            )
            .join("\n");
        })
        .join("\n");
    }
    case "table": {
      const table = token as Tokens.Table;
      const cellText = (cell: unknown): string => {
        if (typeof cell === "string") return stripAnsi(cell);
        if (cell && typeof cell === "object" && "text" in cell) {
          return stripAnsi(String((cell as { text?: unknown }).text ?? ""));
        }
        return "";
      };
      const rows: string[][] = [
        table.header.map(cellText),
        ...table.rows.map((r) => r.map(cellText)),
      ];
      const widths = table.header.map((_, i) =>
        Math.max(...rows.map((r) => (r[i] ?? "").length), table.align[i] ? 3 : 0),
      );
      const fmt = (cells: string[]): string =>
        cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join(" │ ");
      const sep = widths.map((w) => "─".repeat(w)).join("─┼─");
      const out = [fmt(rows[0] ?? []), sep, ...rows.slice(1).map(fmt)];
      return out.map((line) => `${pad}${C.table}${line}${RESET}`).join("\n");
    }
    case "hr":
      return `${pad}${C.hr}${"─".repeat(48)}${RESET}`;
    case "html":
      return `${pad}${DIM}${sanitize(token.text)}${RESET}`;
    case "def":
      return "";
    default:
      return "";
  }
}

function renderInline(tokens: InlineToken[]): string {
  return tokens.map(renderInlineToken).join("");
}

function renderInlineToken(t: InlineToken): string {
  switch (t.type) {
    case "text":
      return sanitize(t.text ?? "");
    case "strong":
      return `${BOLD}${renderInline(t.tokens ?? [])}${RESET}`;
    case "em":
      return `${ITALIC}${C.em}${renderInline(t.tokens ?? [])}${RESET}`;
    case "codespan":
      return `${C.codeBg}${C.code}${sanitize(t.text ?? "")}${RESET}`;
    case "link":
      return `${UNDERLINE}${C.link}${renderInline(t.tokens ?? [{ type: "text", text: t.text ?? "" }])}${RESET}${DIM} (${sanitize(t.href ?? "")})${RESET}`;
    case "image":
      return `${DIM}[图片: ${sanitize(t.text ?? "")}]${RESET}`;
    case "br":
      return "\n";
    case "del":
      return `${STRIKE}${C.del}${renderInline(t.tokens ?? [])}${RESET}`;
    case "escape":
      return sanitize(t.text ?? "");
    default:
      return sanitize(t.text ?? "");
  }
}

/** 估算渲染文本在终端中占用的行数（含换行折行） */
export function terminalLines(text: string, columns: number): number {
  let lines = 0;
  for (const line of text.split("\n")) {
    const visible = stripAnsi(line).length;
    lines += Math.max(1, Math.ceil(visible / Math.max(1, columns)));
  }
  return lines;
}

/** 流式 Markdown 渲染器：累积缓冲并对整块重渲染（跨 chunk 的语法也能正确合并） */
export class MarkdownStream {
  private buffer = "";
  private lines = 0;
  private readonly columns: number;

  constructor(columns: number = process.stdout.columns ?? 80) {
    this.columns = columns;
  }

  append(chunk: string): void {
    this.buffer += chunk;
    this.render();
  }

  finish(): void {
    this.lines = 0;
    this.buffer = "";
  }

  private render(): void {
    const styled = renderMarkdown(this.buffer);
    const target = terminalLines(styled, this.columns);
    if (this.lines > 0) {
      process.stdout.write(`\x1b[${this.lines}A`);
      for (let i = 0; i < this.lines; i += 1) process.stdout.write("\x1b[2K");
      process.stdout.write("\r");
    }
    process.stdout.write(styled);
    this.lines = target;
  }
}
