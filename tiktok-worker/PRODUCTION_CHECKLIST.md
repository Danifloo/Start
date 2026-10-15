# GoNews Publisher — configuration review, October 15, 2026

## Evidence and limits

- Repository: `Danifloo/Start`, branch `main`.
- The latest supplied TikTok Developers screenshot, captured October 15 at about 16:35 New York time, shows **Production: Draft**, not approved. The live developer dashboard could not be opened during this review.
- The supplied recording shows successful **Sandbox Login Kit** authorization, explicitly without public posting rights. This proves test login, not production approval or verification of the account handle.
- The deployed Worker `/health` returns HTTP 200. GitHub reports successful **Workers Builds: gonews-tiktok-auth** and Pages deployment for the inspected main commit. These prove hosting/builds, not TikTok approval.
- Public home, privacy, terms and GitHub Pages verification-file URLs respond. File presence does not prove that TikTok accepted a URL property.
- Private `/status` and `/diagnostics` were not accessed with administrator credentials. The stored token's current validity is unverified.

## Preserve working configuration

- Keep `TIKTOK_MODE = "sandbox"` and `PUBLISHING_ENABLED = "false"`.
- Keep the exact callback: `https://gonews-tiktok-auth.daniloflores835.workers.dev/callback`.
- Keep the existing `AUTH_STORE` namespace and all encrypted secrets, including the stable token encryption key. Do not rotate, replace, disclose or migrate working credentials.
- Web/Desktop homepage is `https://danifloo.github.io/Start/`, separate from the callback.
- Sandbox requests only `user.info.basic`. A future Production connection requests `user.info.basic,video.publish`. Inbox/draft upload (`video.upload`) is not implemented.
- Diagnostics `ready: true` means OAuth configuration is complete, not Production approval.

## Requirements before review

1. **Intended use:** TikTok's current App Review and Direct Post guidelines exclude private/personal apps and utilities limited to accounts managed by their owner or team. The current owner-only architecture has this product eligibility blocker. Do not claim a public product or remove truthful disclosures to imply eligibility. A real supported public product needs a separate scope decision and implementation.
2. **Production form:** check and save the actual app name/icon, description, Terms URL, Privacy URL, Web platform, homepage and exact Login Kit Web redirect in TikTok Developers. The screenshot shows a homepage and redirect entry, but not a readable complete callback value. Do not overwrite it blindly.
3. **Scopes:** reconcile the form with implemented features. The screenshot includes `video.upload` alongside `user.info.basic` and `video.publish`, but inbox upload is not implemented. Check the live draft before removing an unused requested scope. Listing a scope does not grant it.
4. **Real demo:** after resolving eligibility, demonstrate actual OAuth permissions, connected creator nickname, selected MP4/preview, editable caption, manually selected privacy, interaction settings, duration limit, commercial disclosure, consent and confirmed status. The existing recording demonstrates local pages and Sandbox login only. Do not simulate a successful production post or claim a completed API demo.
5. **URL ownership:** check saved URL properties for the homepage, Terms and Privacy. The current local-device `FILE_UPLOAD` flow does not need a video-host domain. Any future `PULL_FROM_URL` flow needs verification of its actual media domain/prefix; GitHub Pages verification does not cover a different Worker/storage host.
6. **Public service:** a public launch requires real support/deletion channels, account lifecycle controls and a functional public product. The private prototype is not that product.

## Separate confirmation later

Do not send a review/audit request, switch working credentials to Production, enable publishing or send any video during this setup review. A walkthrough can be prepared without sending a video to TikTok; a real posting demonstration needs explicit owner authorization before that step.

## Official references

- https://developers.tiktok.com/docs/en/app-review-guidelines
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
