# levelup-poster

Minimal Postiz replacement for one store. Drafts live as JSON files in `queue/`,
you approve them by hand, the CLI publishes to Threads, X, TikTok and Instagram Reels
through their official APIs. No database, no server, no runtime dependencies.

```
npm install
cp .env.example .env     # fill in app credentials
npm run poster -- help
```

## Flow (first week = manual)

1. Claude (or you) writes drafts → `npm run poster -- import drafts.json`
2. Review: `list`, `show <id>`
3. `approve <id>` the ones you like
4. `post --approved --dry-run` to see exact API payloads
5. `post --approved` to publish

Draft format (`examples/drafts.json`):

```json
{
  "platform": "threads | x | tiktok | instagram",
  "text": "single post",
  "parts": ["thread root", "reply 1", "reply 2"],
  "media": { "kind": "image | video", "url": "https://…", "file": "media/clip.mp4" },
  "note": "why this post / UTM campaign"
}
```

Use `text` **or** `parts`. `media` is optional for Threads/X, required for TikTok (video)
and Instagram (image or video).

## Connecting channels

Every platform needs its own developer app. Each `auth` command prints a URL, you approve
in the browser, land on the redirect URI (a 404 page is fine), paste that URL back.
Tokens are stored in `tokens.json` (gitignored) and refreshed automatically.

### Threads
1. https://developers.facebook.com → create app → add **Threads API** use case.
2. Threads API settings → add redirect URI (must be https; `https://localhost/callback` works
   for pasting the code manually).
3. Add your Threads account as a tester (App roles → Threads testers) and accept the invite
   in Threads app settings → Website permissions.
4. `.env`: `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI`.
5. `npm run poster -- auth threads`

Token lives 60 days, refreshed on use.

### X
1. https://developer.x.com → project → app → **User authentication settings**:
   OAuth 2.0, type *Web App*, callback `http://localhost:8787/callback`, permissions Read+Write.
2. `.env`: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`.
3. `npm run poster -- auth x`

Free tier: ~500 writes/month, enough for a daily thread. Media upload not implemented yet —
X posts go text-only (warning printed if media present).

### TikTok
1. https://developers.tiktok.com → app → add **Login Kit** + **Content Posting API**,
   scopes `user.info.basic`, `video.publish`.
2. Redirect URI must be https and match exactly.
3. `.env`: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`.
4. `npm run poster -- auth tiktok`

Until the app passes TikTok review, videos can only be posted as **SELF_ONLY**
(visible to you). That is the default. After review set `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE`.
Local files upload directly (`media.file`); `media.url` requires a domain verified in the
TikTok app settings.

### Instagram Reels
1. Same Meta app (or a new one) → add **Instagram API with Instagram Login** use case.
2. Account must be Business or Creator.
3. `.env`: `IG_APP_ID`, `IG_APP_SECRET`, `IG_REDIRECT_URI`.
4. `npm run poster -- auth instagram`

Instagram only accepts a **public video URL** — upload the file to Shopify Files
(Content → Files in admin) and use the CDN link. Same for Threads video/image.

## Commands

```
auth <platform>
whoami
add <platform> --text "..." | --part "a" --part "b"  [--media-url U | --media-file F] [--video] [--note N]
import <file.json>
list [--status s] [--platform p]
show <id>
approve <id...> / unapprove <id...>
post <id...> [--dry-run] [--force]
post --approved [--dry-run]
```

Statuses: `○ draft` `● approved` `✓ posted` `✗ failed`. Failed posts keep the error in the JSON.

## Next

- Scheduled run (`post --approved` on a cron) once drafts are trusted
- X media upload (v2 chunked upload)
- `media upload` command → Shopify Files via GraphQL `stagedUploadsCreate`, returns CDN URL
- Telegram digest through the existing CF Worker
