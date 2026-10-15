# GoNews Publisher — TikTok OAuth connection backend

This is the **next phase of the GoNews TikTok plugin**. It implements an owner-protected TikTok OAuth authorization callback, verifies that the TikTok account being connected is `@g0news1`, and saves OAuth tokens encrypted with AES-GCM in Cloudflare Workers KV. **It is not yet a production video uploader**, and no video has been published with it.

## Prerequisites

- GitHub repository: https://github.com/Danifloo/Start
- Official GoNews public information site: https://danifloo.github.io/Start/
- TikTok developer app `GoNews Publisher` with Web platform, Login Kit, Content Posting API Direct Post and `video.publish`.
- A free Cloudflare account: https://dash.cloudflare.com/
- A Cloudflare Worker with a stable HTTPS `*.workers.dev` URL. GitHub Pages is **not** the OAuth backend.

## Deploy the Worker (do not paste secrets into GitHub)

1. In Cloudflare, navigate to **Workers & Pages → Create → Worker**, choose a unique name (e.g., `gonews-tiktok-auth`), and deploy a basic Worker.
2. Open the Worker → **Edit code** and replace the generated script with [src/index.js](src/index.js). Deploy. (This can later be automated with Wrangler.)
3. In Worker **Settings → Bindings**, create/bind a **Workers KV** namespace with variable name `AUTH_STORE`. The namespace holds encrypted OAuth tokens and short-lived authorization state. KV availability/quotas can change by plan.
4. In Worker **Settings → Variables and Secrets**, add the following values as **encrypted secrets**, not as public plaintext variables:
   - `TIKTOK_CLIENT_KEY`: from your TikTok app credentials (never share screenshots of secrets).
   - `TIKTOK_CLIENT_SECRET`: from TikTok.
   - `TIKTOK_REDIRECT_URI`: **your actual deployed Worker URL + `/callback`**, e.g. `https://YOUR-REAL-WORKER.YOUR-SUBDOMAIN.workers.dev/callback` (example only; DO NOT put this placeholder into TikTok).
   - `ADMIN_USERNAME`: private owner-only username.
   - `ADMIN_PASSWORD`: password-manager-generated random, unique long password.
   - `TOKEN_ENCRYPTION_KEY`: 32 cryptographically random bytes encoded in standard base64 (generate locally and store privately; keep the value stable across deploys).
   - `TIKTOK_ACCOUNT`: `g0news1`.
5. In TikTok Developers → your app → **Login Kit → Web → Redirect URI**, add the exact `TIKTOK_REDIRECT_URI` above and save it. Web/Desktop URL is the separate GitHub Pages homepage, **not** the callback.
6. Visit `https://YOUR-REAL-WORKER.YOUR-SUBDOMAIN.workers.dev/health` to confirm that the Worker responds. Check that it belongs to your deployment.
7. Visit `https://YOUR-REAL-WORKER.YOUR-SUBDOMAIN.workers.dev/connect` in a browser. HTTP Basic credentials are requested. Then TikTok asks the owner to authorize `video.publish`; approve only for your own `@g0news1` account.
8. Visit `/status` to verify `connected: true` and the expected username. Tokens are **not** returned by the endpoint.

## Critical limitations and safety

- **Do not start deployment until the site owner has reviewed the official TikTok app and its requested scopes.** Public publishing needs the separate TikTok app review/audit.
- This backend only handles OAuth. It does not yet refresh expired tokens, accept uploaded videos, offer an authenticated remote MCP endpoint, publish videos or run a schedule. These are separate engineering tasks.
- This is a development example, not a security-audited production service. The Basic-auth protected admin routes use a secret transmitted only over HTTPS; consider identity-aware access and rate limiting before production. Do not expose administrative credentials or token values in support chats.
- The Google/GitHub static web site is informational and its current privacy policy describes **only that static site**. Update the public privacy policy accurately **before enabling the live OAuth service** to disclose token handling, hosting provider, storage, deletion process and relevant contact details.
- Cloudflare Workers free tier does not remove TikTok posting quotas. TikTok may limit each creator and non-reviewed apps cannot publicly post.
- `/connect` and `/status` are **not** a public ChatGPT plugin. A remote MCP server with authenticated controls is a future step.
- A valid HTTPS callback must respond on the server. **Do not enter an invented URL or a GitHub Pages URL as Redirect URI.**

Official developer guidance: https://developers.tiktok.com/doc/login-kit-web/ and https://developers.tiktok.com/doc/content-posting-api-get-started/
