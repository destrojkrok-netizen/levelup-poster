import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { json, form, env, logRequest } from "../http.ts";
import type { PlatformClient, PublishResult } from "../types.ts";

const API = "https://open.tiktokapis.com/v2";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const tiktok: PlatformClient = {
  name: "tiktok",

  authUrl() {
    const q = form({
      client_key: env("TIKTOK_CLIENT_KEY"),
      scope: "user.info.basic,video.publish",
      response_type: "code",
      redirect_uri: env("TIKTOK_REDIRECT_URI"),
      state: randomBytes(8).toString("hex"),
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  },

  async exchangeCode(code) {
    const r = await json<{
      access_token: string; refresh_token: string; expires_in: number; open_id: string;
    }>(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        client_key: env("TIKTOK_CLIENT_KEY"),
        client_secret: env("TIKTOK_CLIENT_SECRET"),
        code,
        grant_type: "authorization_code",
        redirect_uri: env("TIKTOK_REDIRECT_URI"),
      }),
    });
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token,
      expiresAt: Date.now() + r.expires_in * 1000,
      userId: r.open_id,
    };
  },

  async refresh(t) {
    const r = await json<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${API}/oauth/token/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({
          client_key: env("TIKTOK_CLIENT_KEY"),
          client_secret: env("TIKTOK_CLIENT_SECRET"),
          grant_type: "refresh_token",
          refresh_token: t.refreshToken,
        }),
      },
    );
    return { ...t, accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 };
  },

  async whoami(t) {
    const r = await json<{ data: { user: { open_id: string; display_name: string } } }>(
      `${API}/user/info/?fields=open_id,display_name`,
      { headers: { Authorization: `Bearer ${t.accessToken}` } },
    );
    return { id: r.data.user.open_id, username: r.data.user.display_name };
  },

  async publish(t, post, { dryRun }): Promise<PublishResult> {
    const m = post.media;
    if (!m || m.kind !== "video") throw new Error("TikTok post needs media.kind = video");
    const title = (post.text ?? post.parts?.[0] ?? "").slice(0, 2200);

    // Unaudited apps may only publish SELF_ONLY. Flip to PUBLIC_TO_EVERYONE after app review.
    const post_info = {
      title,
      privacy_level: process.env.TIKTOK_PRIVACY ?? "SELF_ONLY",
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      video_cover_timestamp_ms: 1000,
    };

    let body: Record<string, unknown>;
    let localFile: string | undefined;
    if (m.file) {
      localFile = join(ROOT, m.file);
      const size = statSync(localFile).size;
      body = {
        post_info,
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
      };
    } else if (m.url) {
      body = { post_info, source_info: { source: "PULL_FROM_URL", video_url: m.url } };
    } else {
      throw new Error("TikTok media needs .file or .url");
    }

    if (dryRun) {
      logRequest(`POST ${API}/post/publish/video/init/`, body);
      return { ids: ["dry"] };
    }

    const init = await json<{ data: { publish_id: string; upload_url?: string } }>(
      `${API}/post/publish/video/init/`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${t.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(body),
      },
    );

    if (localFile && init.data.upload_url) {
      const buf = readFileSync(localFile);
      const res = await fetch(init.data.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(buf.length),
          "Content-Range": `bytes 0-${buf.length - 1}/${buf.length}`,
        },
        body: buf,
      });
      if (!res.ok) throw new Error(`TikTok upload failed ${res.status}: ${await res.text()}`);
    }

    return { ids: [init.data.publish_id] };
  },
};
