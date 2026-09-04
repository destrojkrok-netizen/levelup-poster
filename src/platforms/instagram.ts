import { json, form, sleep, env, logRequest } from "../http.ts";
import type { PlatformClient, PublishResult } from "../types.ts";

const API = "https://graph.instagram.com/v21.0";

export const instagram: PlatformClient = {
  name: "instagram",

  authUrl() {
    const q = form({
      client_id: env("IG_APP_ID"),
      redirect_uri: env("IG_REDIRECT_URI"),
      scope: "instagram_business_basic,instagram_business_content_publish",
      response_type: "code",
    });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  },

  async exchangeCode(code) {
    const short = await json<{ access_token: string; user_id: number }>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        body: form({
          client_id: env("IG_APP_ID"),
          client_secret: env("IG_APP_SECRET"),
          grant_type: "authorization_code",
          redirect_uri: env("IG_REDIRECT_URI"),
          code,
        }),
      },
    );
    const long = await json<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${env("IG_APP_SECRET")}&access_token=${short.access_token}`,
    );
    return {
      accessToken: long.access_token,
      expiresAt: Date.now() + long.expires_in * 1000,
      userId: String(short.user_id),
    };
  },

  async refresh(t) {
    const r = await json<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${t.accessToken}`,
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
    const m = post.media;
    if (!m?.url) throw new Error("Instagram post needs media.url (public URL)");
    const caption = post.text ?? post.parts?.join("\n\n") ?? "";
    const body =
      m.kind === "video"
        ? { media_type: "REELS", video_url: m.url, caption, share_to_feed: "true" }
        : { image_url: m.url, caption };

    if (dryRun) {
      logRequest(`POST ${API}/${t.userId}/media`, body);
      return { ids: ["dry"] };
    }

    const c = await json<{ id: string }>(`${API}/${t.userId}/media`, {
      method: "POST",
      body: form({ ...body, access_token: t.accessToken }),
    });

    // Video containers process async; poll until FINISHED.
    if (m.kind === "video") {
      for (let i = 0; i < 40; i++) {
        const s = await json<{ status_code: string }>(
          `${API}/${c.id}?fields=status_code&access_token=${t.accessToken}`,
        );
        if (s.status_code === "FINISHED") break;
        if (s.status_code === "ERROR") throw new Error("Instagram container ERROR");
        await sleep(5000);
      }
    }

    const p = await json<{ id: string }>(`${API}/${t.userId}/media_publish`, {
      method: "POST",
      body: form({ creation_id: c.id, access_token: t.accessToken }),
    });
    return { ids: [p.id] };
  },
};
