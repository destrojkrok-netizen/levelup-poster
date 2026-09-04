import { json, form, sleep, env, logRequest } from "../http.ts";
import type { PlatformClient, Post, TokenSet, PublishResult } from "../types.ts";

const API = "https://graph.threads.net/v1.0";

async function waitContainer(id: string, token: string) {
  for (let i = 0; i < 20; i++) {
    const r = await json<{ status: string; error_message?: string }>(
      `${API}/${id}?fields=status,error_message&access_token=${token}`,
    );
    if (r.status === "FINISHED") return;
    if (r.status === "ERROR") throw new Error(`Threads container error: ${r.error_message}`);
    await sleep(3000);
  }
  throw new Error("Threads container not ready after 60s");
}

async function createAndPublish(
  t: TokenSet,
  body: Record<string, string | undefined>,
  dryRun: boolean,
): Promise<string> {
  const create = { ...body, access_token: t.accessToken };
  if (dryRun) {
    logRequest(`POST ${API}/${t.userId}/threads`, { ...body, access_token: "***" });
    return "dry";
  }
  const c = await json<{ id: string }>(`${API}/${t.userId}/threads`, {
    method: "POST",
    body: form(create),
  });
  if (body.media_type !== "TEXT") await waitContainer(c.id, t.accessToken);
  const p = await json<{ id: string }>(`${API}/${t.userId}/threads_publish`, {
    method: "POST",
    body: form({ creation_id: c.id, access_token: t.accessToken }),
  });
  return p.id;
}

export const threads: PlatformClient = {
  name: "threads",

  authUrl() {
    const q = form({
      client_id: env("THREADS_APP_ID"),
      redirect_uri: env("THREADS_REDIRECT_URI"),
      scope: "threads_basic,threads_content_publish",
      response_type: "code",
    });
    return `https://threads.net/oauth/authorize?${q}`;
  },

  async exchangeCode(code) {
    const short = await json<{ access_token: string; user_id: number }>(
      "https://graph.threads.net/oauth/access_token",
      {
        method: "POST",
        body: form({
          client_id: env("THREADS_APP_ID"),
          client_secret: env("THREADS_APP_SECRET"),
          grant_type: "authorization_code",
          redirect_uri: env("THREADS_REDIRECT_URI"),
          code,
        }),
      },
    );
    // Exchange for 60-day token.
    const long = await json<{ access_token: string; expires_in: number }>(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${env("THREADS_APP_SECRET")}&access_token=${short.access_token}`,
    );
    return {
      accessToken: long.access_token,
      expiresAt: Date.now() + long.expires_in * 1000,
      userId: String(short.user_id),
    };
  },

  async refresh(t) {
    const r = await json<{ access_token: string; expires_in: number }>(
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${t.accessToken}`,
    );
    return { ...t, accessToken: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 };
  },

  async whoami(t) {
    const r = await json<{ id: string; username: string }>(
      `${API}/me?fields=id,username&access_token=${t.accessToken}`,
    );
    return { id: r.id, username: r.username };
  },

  async publish(t, post, { dryRun }): Promise<PublishResult> {
    const parts = post.parts ?? [post.text ?? ""];
    const ids: string[] = [];
    let replyTo: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const isRoot = i === 0;
      const m = isRoot ? post.media : undefined;
      const body: Record<string, string | undefined> = {
        media_type: m ? (m.kind === "video" ? "VIDEO" : "IMAGE") : "TEXT",
        text: parts[i],
        reply_to_id: replyTo,
        ...(m?.kind === "video" ? { video_url: m.url } : {}),
        ...(m?.kind === "image" ? { image_url: m.url } : {}),
      };
      const id = await createAndPublish(t, body, dryRun);
      ids.push(id);
      replyTo = id;
    }
    return { ids, url: t.username ? `https://www.threads.net/@${t.username}/post/${ids[0]}` : undefined };
  },
};
