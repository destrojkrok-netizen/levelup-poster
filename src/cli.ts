#!/usr/bin/env -S node --env-file=.env --import tsx
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { client, clients } from "./platforms/index.ts";
import { getToken, setToken, listTokens } from "./tokens.ts";
import * as q from "./queue.ts";
import type { Post, Platform, Status, TokenSet } from "./types.ts";

const HELP = `poster — manual social publisher (Threads / X / TikTok / Instagram Reels)

  auth <platform>                 OAuth: prints URL, paste redirect URL back
  whoami                          Show connected accounts + token expiry

  add <platform> --text "..."     Add a single-post draft
  add <platform> --part "a" --part "b"   Add a thread draft
      [--media-url URL | --media-file path] [--video] [--note "..."]
  import <file.json>              Import array of drafts (Claude writes these)

  list [--status draft|approved|posted|failed] [--platform p]
  show <id>
  approve <id...>                 draft -> approved
  unapprove <id...>               approved -> draft
  post <id...> [--dry-run]        Publish specific posts
  post --approved [--dry-run]     Publish every approved post
`;

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const a = await rl.question(prompt);
  rl.close();
  return a.trim();
}

function fmtDate(ms?: number) {
  return ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "—";
}

function preview(p: Post): string {
  const body = (p.parts ? p.parts.join(" ↳ ") : (p.text ?? "")).replace(/\s+/g, " ");
  return body.length > 120 ? body.slice(0, 117) + "…" : body;
}

async function freshToken(platform: Platform): Promise<TokenSet> {
  const c = client(platform);
  let t = getToken(platform);
  if (!t) throw new Error(`Not authed: run \`poster auth ${platform}\``);
  const soon = Date.now() + 5 * 60_000;
  if (t.expiresAt && t.expiresAt < soon && c.refresh) {
    console.log(`  refreshing ${platform} token…`);
    t = await c.refresh(t);
    setToken(platform, t);
  }
  return t;
}

// ---------- commands ----------

async function cmdAuth(platform: string) {
  const c = client(platform);
  console.log(`\nOpen in browser:\n\n  ${c.authUrl()}\n`);
  console.log("After approving you land on the redirect URI (page may 404 — fine).");
  const raw = await ask("Paste the full redirect URL (or just the code): ");
  let code = raw;
  try {
    code = new URL(raw).searchParams.get("code") ?? raw;
  } catch {
    /* plain code */
  }
  code = code.replace(/#_$/, ""); // Meta appends #_
  let t = await c.exchangeCode(code);
  const me = await c.whoami(t);
  t = { ...t, userId: t.userId ?? me.id, username: me.username };
  setToken(c.name, t);
  console.log(`\n✓ ${c.name} connected as @${me.username ?? me.id}, expires ${fmtDate(t.expiresAt)}`);
}

function cmdWhoami() {
  const s = listTokens();
  for (const p of Object.keys(clients) as Platform[]) {
    const t = s[p];
    console.log(
      t
        ? `  ${p.padEnd(10)} @${t.username ?? t.userId}  exp ${fmtDate(t.expiresAt)}`
        : `  ${p.padEnd(10)} — not connected`,
    );
  }
}

function cmdAdd(platform: string, v: Record<string, any>) {
  const c = client(platform);
  if (!v.text && !v.part?.length) throw new Error("Need --text or --part");
  const post: Post = {
    id: q.newId(c.name),
    platform: c.name,
    status: "draft",
    createdAt: new Date().toISOString(),
    ...(v.text ? { text: v.text } : {}),
    ...(v.part?.length ? { parts: v.part } : {}),
    ...(v.note ? { note: v.note } : {}),
  };
  if (v["media-url"] || v["media-file"]) {
    post.media = {
      kind: v.video ? "video" : "image",
      ...(v["media-url"] ? { url: v["media-url"] } : {}),
      ...(v["media-file"] ? { file: v["media-file"] } : {}),
    };
  }
  q.save(post);
  console.log(`✓ draft ${post.id}`);
}

function cmdImport(file: string) {
  const arr = JSON.parse(readFileSync(file, "utf8")) as Partial<Post>[];
  if (!Array.isArray(arr)) throw new Error("Expected JSON array");
  for (const d of arr) {
    if (!d.platform) throw new Error("Each draft needs platform");
    client(d.platform);
    const post: Post = {
      ...d,
      id: d.id ?? q.newId(d.platform),
      platform: d.platform,
      status: d.status ?? "draft",
      createdAt: d.createdAt ?? new Date().toISOString(),
    };
    q.save(post);
    console.log(`✓ ${post.status.padEnd(8)} ${post.id}`);
  }
}

function cmdList(v: Record<string, any>) {
  const posts = q.all({ status: v.status as Status, platform: v.platform as Platform });
  if (!posts.length) return console.log("  (empty)");
  for (const p of posts) {
    const flag = p.status === "posted" ? "✓" : p.status === "approved" ? "●" : p.status === "failed" ? "✗" : "○";
    console.log(`${flag} ${p.id.padEnd(26)} ${p.platform.padEnd(9)} ${preview(p)}`);
  }
}

function cmdShow(id: string) {
  console.log(JSON.stringify(q.get(id), null, 2));
}

function cmdSetStatus(ids: string[], status: Status) {
  for (const id of ids) {
    q.setStatus(id, status);
    console.log(`✓ ${id} -> ${status}`);
  }
}

async function cmdPost(ids: string[], v: Record<string, any>) {
  const dryRun = Boolean(v["dry-run"]);
  const targets = v.approved ? q.all({ status: "approved" }) : ids.map(q.get);
  if (!targets.length) return console.log("  nothing to post");

  for (const p of targets) {
    if (p.status === "posted") {
      console.log(`- ${p.id} already posted, skip`);
      continue;
    }
    if (p.status !== "approved" && !v.force) {
      console.log(`- ${p.id} is ${p.status}, not approved (use --force to post anyway)`);
      continue;
    }
    console.log(`→ ${p.id} [${p.platform}]${dryRun ? " (dry-run)" : ""}`);
    try {
      const t = dryRun ? (getToken(p.platform) ?? { accessToken: "dry", userId: "ME", username: "me" }) : await freshToken(p.platform);
      const r = await client(p.platform).publish(t, p, { dryRun });
      if (!dryRun) {
        q.setStatus(p.id, "posted", { postedAt: new Date().toISOString(), result: r as any, error: undefined });
        console.log(`  ✓ posted ${r.url ?? r.ids.join(",")}`);
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!dryRun) q.setStatus(p.id, "failed", { error: msg });
      console.error(`  ✗ ${msg}`);
    }
  }
}

// ---------- main ----------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    text: { type: "string" },
    part: { type: "string", multiple: true },
    note: { type: "string" },
    "media-url": { type: "string" },
    "media-file": { type: "string" },
    video: { type: "boolean" },
    status: { type: "string" },
    platform: { type: "string" },
    approved: { type: "boolean" },
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const [cmd, ...rest] = positionals;

try {
  switch (cmd) {
    case "auth": await cmdAuth(rest[0]); break;
    case "whoami": cmdWhoami(); break;
    case "add": cmdAdd(rest[0], values); break;
    case "import": cmdImport(rest[0]); break;
    case "list": cmdList(values); break;
    case "show": cmdShow(rest[0]); break;
    case "approve": cmdSetStatus(rest, "approved"); break;
    case "unapprove": cmdSetStatus(rest, "draft"); break;
    case "post": await cmdPost(rest, values); break;
    default: console.log(HELP); if (cmd && !values.help) process.exit(1);
  }
} catch (e: any) {
  console.error(`✗ ${e?.message ?? e}`);
  process.exit(1);
}
