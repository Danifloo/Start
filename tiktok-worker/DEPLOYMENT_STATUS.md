# Cloudflare deployment

The user connected Cloudflare Workers Builds to `Danifloo/Start` on the `main` branch.

This commit triggers Cloudflare's first build of the `tiktok-worker` OAuth backend via `cd tiktok-worker && npx wrangler deploy`.

Before connecting the TikTok account, add the AUTH_STORE KV binding and secrets described in README.md. Until these are set, `/connect` deliberately refuses to run.

This project is not yet an installed ChatGPT plugin, and does not publish videos automatically.
