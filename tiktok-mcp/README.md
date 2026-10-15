# GoNews — TikTok Publishing MCP (prototype)

A Python MCP server for posting **your own MP4 videos** through TikTok's official Content Posting API, without Metricool.

**Current status:** source code only. Not yet deployed, installed in ChatGPT, or authorized to post by TikTok. **It does not provide unlimited TikTok posts.**

## Commands

- `account_and_post_options` — verify connected TikTok username and allowed privacy.
- `list_videos` — list locally staged MP4s.
- `publish_staged_video` — upload one explicitly approved MP4, avoiding repeated submissions.
- `check_publication` — verify the actual TikTok publication status.

## Setup

1. Register a TikTok developer app at https://developers.tiktok.com and obtain the `video.publish` scope.
2. Complete TikTok OAuth authorization for your own account. **Do not publish access tokens in GitHub or chats.** This MVP uses a manually supplied access token and does not yet implement token refresh.
3. Install Python 3.11+ and dependencies: `pip install -r requirements.txt`.
4. Set `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ACCOUNT=g0news1`, and `TIKTOK_AUDITED=false` in a private environment.
5. Stage an MP4 as `videos/<32 hexadecimal characters>.mp4` on the hosting server. The MVP supports videos up to 64 MB.
6. Start with `python server.py`; it exposes a local streamable HTTP MCP service.

**CRITICAL:** This prototype's MCP endpoint is not authenticated. **Do not expose the server to the internet or connect it to a remote plugin until you implement authentication (and HTTPS), token storage/refresh, upload protection, owner approval and hosting.**

Unaudited TikTok apps can only test privately (`SELF_ONLY`). Public publishing needs TikTok's approval. TikTok's own posting/rate limitations still apply.

Official TikTok documentation:
- https://developers.tiktok.com/doc/content-posting-api-get-started
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
