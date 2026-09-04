export type Platform = "threads" | "x" | "tiktok" | "instagram";

export type Status = "draft" | "approved" | "posted" | "failed";

export interface Media {
  /** Public URL (Threads / Instagram / TikTok PULL_FROM_URL). */
  url?: string;
  /** Local file path relative to project root (TikTok FILE_UPLOAD). */
  file?: string;
  kind: "image" | "video";
}

export interface Post {
  id: string;
  platform: Platform;
  status: Status;
  /** Single text post. For X/Threads a thread is `parts`. */
  text?: string;
  /** Thread: first element is the root post, rest are replies. */
  parts?: string[];
  media?: Media;
  /** Free-form note for the reviewer (why this post, UTM campaign, etc). */
  note?: string;
  createdAt: string;
  scheduledFor?: string;
  postedAt?: string;
  /** Platform-side ids / permalinks after publish. */
  result?: Record<string, unknown>;
  error?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Unix ms. */
  expiresAt?: number;
  userId?: string;
  username?: string;
}

export interface PublishResult {
  ids: string[];
  url?: string;
}

export interface PlatformClient {
  name: Platform;
  authUrl(): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refresh?(t: TokenSet): Promise<TokenSet>;
  whoami(t: TokenSet): Promise<{ id: string; username?: string }>;
  publish(t: TokenSet, post: Post, opts: { dryRun: boolean }): Promise<PublishResult>;
}
