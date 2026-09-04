import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { json, form, env, logRequest } from "../http.ts";
import type { PlatformClient, PublishResult } from "../types.ts";

const API = "https://api.x.com/2";
const VERIFIER_FILE = new URL("../../.x-pkce", import.meta.url);

function basic() {
  return "Basic " + Buffer.from(`${env("X_CLIENT_ID")}:${env("X_CLIENT_SECRET")}`).toString("base64");
}

export const x: PlatformClient = {
  name: "x",

  authUrl() {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    writeFileSync(VERIFIER_FILE, verifier);
    const q = form({
      response_type: "code",
      client_id: env("X_CLIENT_ID"),
      redirect_uri: env("X_REDIRECT_URI"),
      scope: "tweet.read tweet.write users.read offline.access",
      state: randomBytes(8).toString("hex"),
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },

  async exchangeCode(code) {
    if (!existsSync(VERIFIER_FILE)) throw new Error("Run `auth x` first to generate PKCE verifier");
    const verifier = readFileSync(VERIFIER_FILE, "utf8");
    const r = await json<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${API}/oauth2/token`,
      {
        method: "POST",
        headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
        body: form({
          grant_type: "authorization_code",
          code,
          redirect_uri: env("X_REDIRECT_URI"),
          code_verifier: verifier,
          client_id: env("X_CLIENT_ID"),
        }),
      },
    );
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token,
      expiresAt: Date.now() + r.expires_in * 1000,
    };
  },

  async refresh(t) {
    const r = await json<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${API}/oauth2/token`,
      {
        method: "POST",
        headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ grant_type: "refresh_token", refresh_token: t.refreshToken, client_id: env("X_CLIENT_ID") }),
      },
    );
    return {
      ...t,
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? t.refreshToken,
      expiresAt: Date.now() + r.expires_in * 1000,
    };
  },

  async whoami(t) {
    const r = await json<{ data: { id: string; username: string } }>(`${API}/users/me`, {
      headers: { Authorization: `Bearer ${t.accessToken}` },
    });
    return { id: r.data.id, username: r.data.username };
  },

  async publish(t, post, { dryRun }): Promise<PublishResult> {
    if (post.media) console.warn("  ! X media upload not implemented yet — posting text only");
    const parts = post.parts ?? [post.text ?? ""];
    const ids: string[] = [];
    let replyTo: string | undefined;
    for (const text of parts) {
      if (text.length > 280) throw new Error(`X part exceeds 280 chars (${text.length}): ${text.slice(0, 40)}…`);
      const body = { text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) };
      if (dryRun) {
        logRequest(`POST ${API}/tweets`, body);
        ids.push("dry");
        continue;
      }
      const r = await json<{ data: { id: string } }>(`${API}/tweets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ids.push(r.data.id);
      replyTo = r.data.id;
    }
    return { ids, url: t.username ? `https://x.com/${t.username}/status/${ids[0]}` : undefined };
  },
};
