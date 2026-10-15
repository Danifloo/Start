# M2 Publisher — private Instagram news scheduler

**Status:** the app source is ready for deployment. It is not deployed or connected to Instagram yet. Do not claim a post is published until Meta returns its public permalink.

This is the private M2 NEWS administration app for **@maqued2**. It supports a password-protected mobile dashboard, verified media uploads, a persistent queue, quarter-hour publishing slots (America/New_York), native Instagram Login OAuth, real publication status/permalink checks and a live Meta publishing-quota check. It does **not** bypass Instagram/Meta limits or automatically generate verified news/designs without an additional editorial integration.

## Source code and deployment

The full source is stored as `M2_Publisher_GitHub.tar.xz` next to this README. The `Dockerfile` in this directory extracts the source during a container build. On a computer, you can also run `tar -xJf M2_Publisher_GitHub.tar.xz` to inspect all application files. **Never commit `.env`, API keys, admin passwords or Meta access tokens.**

For Railway, import **Danifloo/Start** and set **Root Directory** to `m2-publisher`; Railway will use this directory's Dockerfile. Configure a persistent volume mounted at `/data` (and set `DATA_DIR=/data`) before connecting Instagram. Choose 1 replica/worker only.

Required private environment variables:

- `ADMIN_PASSWORD`: strong unique password (16+ characters)
- `SESSION_SECRET`: random secret (32+ characters)
- `PUBLIC_BASE_URL`: the final HTTPS address of your deployed app
- `META_APP_ID`, `META_APP_SECRET`: values from your own Meta developer app
- `DATA_DIR=/data`, `ENABLE_SCHEDULER=1`, `META_GRAPH_VERSION=v25.0`
- Recommended: `ENCRYPTION_KEY` (persistent Fernet key), stored only in the hosting service secrets

After deployment, register the exact HTTPS OAuth redirect `https://<your-domain>/auth/instagram/callback` in Meta's Instagram Login setup. Connect the Instagram professional account through the app UI and confirm available permissions and quota. Publish a single test post, verify its permalink, then enable the full editorial workflow only when publishing is confirmed. Check the official Meta documentation and app-review requirements for external users.

## Safety / limitations

- Personal Facebook/Instagram credentials are never collected or stored in GitHub.
- Public repository: application **code is public**; deployment and tokens must stay private.
- Meta API publication quotas still apply; a 96-post/day target might exceed the applicable Meta quota.
- Works only with valid photo assets/licensing and approved Meta access.
- Tests bundled in source (`python -m pytest -q` after installing `pytest` and dependencies); previously verified: **5 passed**.
- The app uses **Canva designs via exported images**, not automatic Canva API rendering; the AI content-generation pipeline remains to be integrated separately.

**Next:** deploy, configure Meta OAuth, authorize @maqued2, and test one real publication.