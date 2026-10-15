# Next steps for GoNews TikTok @g0news1

## Already completed
- Source code for a prototype MCP TikTok publisher committed to GitHub.
- Repository contains no TikTok login details or tokens.
- Automatic syntax and basic file-safety tests in GitHub Actions.

## To unlock real publishing
1. The TikTok account owner opens https://developers.tiktok.com/ and signs in with their own developer account.
2. Create a developer app, add **Content Posting API**, enable **Direct Post** and request `video.publish`.
3. TikTok must approve the scope; owner then authorizes the app for @g0news1 through TikTok Login Kit OAuth. Never paste passwords, access tokens or client secrets into this repository, screenshots or chats.
4. Build/host a secure server with HTTPS, OAuth flow and refresh tokens, access control for MCP tools, secure video upload, audit logs and idempotency. **The current prototype is not production ready.**
5. Follow TikTok's product UX requirements and finish TikTok's app audit for public posts. Unaudited clients are limited to private tests.
6. Choose a ChatGPT configuration that supports external custom MCP tools with write operations, or use the server through another supported agent interface.
7. Test with one authorized, privately visible post and inspect TikTok's status response before claiming publication.
8. Only then enable public posts, scheduling and automation.

## Limits that cannot be removed
- TikTok enforces per-creator publishing quotas; its Content Sharing Guidelines describe a typical upper limit of about 15 posts per 24 hours via the Direct Post API. A custom plugin **cannot** bypass this.
- Read the current docs: https://developers.tiktok.com/docs/en/content-posting-api-get-started and https://developers.tiktok.com/docs/en/content-sharing-guidelines
- OpenAI custom MCP connectors: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

## Important
No real TikTok publication has occurred through this prototype. Do not make the server publicly reachable until authentication, OAuth and access-control safeguards are implemented.
