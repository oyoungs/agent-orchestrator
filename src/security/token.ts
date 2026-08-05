import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function loadOrCreateToken(stateDir: string): { token: string; tokenFile: string } {
  mkdirSync(stateDir, { recursive: true });
  const tokenFile = join(stateDir, "daemon.token");
  if (existsSync(tokenFile)) {
    const token = readFileSync(tokenFile, "utf8").trim();
    if (token.length >= 32) return { token, tokenFile };
  }
  const token = generateToken();
  writeFileSync(tokenFile, token, { mode: 0o600 });
  return { token, tokenFile };
}

export function readToken(stateDir: string): string | null {
  const tokenFile = join(stateDir, "daemon.token");
  if (!existsSync(tokenFile)) return null;
  return readFileSync(tokenFile, "utf8").trim();
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return Buffer.compare(ab, bb) === 0;
}
