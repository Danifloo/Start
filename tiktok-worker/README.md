# GoNews Publisher — private development integration

GoNews connects TikTok through official OAuth and stores authorization data encrypted with AES-GCM in Cloudflare Workers KV. It also contains a private MP4 preparation panel and a guarded Content Posting implementation. **Publishing is disabled.**

## Current status

- Repository: https://github.com/Danifloo/Start
- Public information: https://danifloo.github.io/Start/
- Worker: https://gonews-tiktok-auth.daniloflores835.workers.dev
- Exact callback: https://gonews-tiktok-auth.daniloflores835.workers.dev/callback
- `TIKTOK_MODE = "sandbox"`, `PUBLISHING_ENABLED = "false"`.
- The latest supplied dashboard evidence shows **Production: Draft**. Sandbox authorization is not Production approval.
- TikTok currently excludes private/personal apps and owner/team-only upload utilities from Direct Post approval. This architecture has that unresolved eligibility blocker. See [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md).

## Preserve the working deployment

Cloudflare Workers Builds deploys this directory from `main`. `wrangler.toml` preserves the existing `AUTH_STORE` KV namespace and public configuration. Do not recreate the namespace, change the encryption key, replace working TikTok credentials or alter the callback while resolving review requirements.

These existing values stay in encrypted Cloudflare Worker Secrets, never GitHub or support chats:

- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64, kept stable)

Deployment uses `npx wrangler deploy` from `tiktok-worker`. Do not run `wrangler secret put`, import new secrets or refresh/reconnect authorization as a configuration check. A regular code deployment preserves existing Worker secrets.

## Routes

| Route | Purpose |
| --- | --- |
| `/health` | Public hosting health, unrelated to TikTok approval. |
| `/connect`, `/callback`, `/result` | Owner-initiated OAuth; Sandbox requests only `user.info.basic`. |
| `/status` | Owner-only stored mode, scope and expiry flags; never returns tokens. |
| `/diagnostics` | Owner-only OAuth configuration checks; `ready` does not mean approved. |
| `/posting-readiness` | Owner-only local gate; cannot determine TikTok approval. |
| `/publish` | Owner-only local preview, caption, privacy, interactions, commercial disclosure and consent. |
| `/creator-options` | Current creator details from existing valid Production authorization. |
| `/submit-video` | Rejects unless Production mode and publishing flag are enabled; then requires same-origin submission, current creator permissions, verified account, actual MP4 duration and explicit consent. |
| `/posting-status` | Owner-only confirmation of a previously authorized submission. |

## Verification and limits

Run `npm run check` and `npm test`. Tests use fake settings and mocked networking, never real credentials or videos.

The UI defaults to no privacy selection, no enabled interactions and commercial disclosure off. Music/content consent is explicit. TikTok account restrictions override choices; actual MP4 duration is checked before upload initialization. Status is polled only after a confirmed, enabled submission.

This is owner-only, not a public multi-user product or installed ChatGPT plugin. There is no automatic schedule, inbox upload (`video.upload`), automatic token refresh or self-service deletion. Expired authorization is reported, not changed automatically. Public launch and TikTok review require more product work and eligibility resolution.

Official guidance: https://developers.tiktok.com/docs/en/app-review-guidelines and https://developers.tiktok.com/docs/en/content-sharing-guidelines.

