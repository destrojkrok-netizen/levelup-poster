import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Post, Platform, Status } from "./types.ts";

const DIR = fileURLToPath(new URL("../queue/", import.meta.url));

function path(id: string) {
  return join(DIR, `${id}.json`);
}

export function newId(platform: Platform): string {
  const d = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${d}-${platform}-${randomBytes(2).toString("hex")}`;
}

export function save(post: Post) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(path(post.id), JSON.stringify(post, null, 2) + "\n");
}

export function get(id: string): Post {
  const p = path(id);
  if (!existsSync(p)) throw new Error(`No post ${id}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function all(filter?: { status?: Status; platform?: Platform }): Post[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Post)
    .filter((p) => !filter?.status || p.status === filter.status)
    .filter((p) => !filter?.platform || p.platform === filter.platform)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function setStatus(id: string, status: Status, patch: Partial<Post> = {}): Post {
  const p = { ...get(id), ...patch, status };
  save(p);
  return p;
}
