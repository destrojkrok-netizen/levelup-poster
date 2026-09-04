import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Platform, TokenSet } from "./types.ts";

const FILE = new URL("../tokens.json", import.meta.url);

type Store = Partial<Record<Platform, TokenSet>>;

function load(): Store {
  if (!existsSync(FILE)) return {};
  return JSON.parse(readFileSync(FILE, "utf8"));
}

export function getToken(p: Platform): TokenSet | undefined {
  return load()[p];
}

export function setToken(p: Platform, t: TokenSet) {
  const s = load();
  s[p] = t;
  writeFileSync(FILE, JSON.stringify(s, null, 2) + "\n");
}

export function listTokens(): Store {
  return load();
}
