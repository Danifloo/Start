"""GoNews TikTok publisher prototype — use TikTok's official Content Posting API.

SECURITY: Local development only. DO NOT expose this unauthenticated MCP server.
TikTok user OAuth authorization and public-post audit must be implemented externally.
"""
import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from mcp.server.fastmcp import FastMCP

VIDEO_DIR = Path(os.getenv("VIDEO_DIR", "./videos")).resolve()
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
BASE = "https://open.tiktokapis.com"
TOKEN = os.getenv("TIKTOK_ACCESS_TOKEN", "")
ACCOUNT = os.getenv("TIKTOK_ACCOUNT", "g0news1").lstrip("@").lower()
AUDITED = os.getenv("TIKTOK_AUDITED", "false").lower() == "true"
MAX_FILE_SIZE = 64 * 1024 * 1024
mcp = FastMCP("GoNews TikTok Publisher")


async def api(path: str, body: dict) -> dict:
    if not TOKEN or TOKEN == "REPLACE_ME":
        raise ValueError("Missing TikTok OAuth access token. Obtain official video.publish authorization.")
    async with httpx.AsyncClient(timeout=35) as client:
        response = await client.post(
            BASE + path,
            json=body,
            headers={"Authorization": "Bearer " + TOKEN},
        )
        response.raise_for_status()
        payload = response.json()
    err = payload.get("error", {})
    if err.get("code") not in (None, "ok"):
        raise ValueError(f"TikTok error: {err.get('code')}: {err.get('message')}")
    return payload.get("data", {})


def validated_path(video_id: str) -> Path:
    if len(video_id) != 32 or any(c not in "0123456789abcdef" for c in video_id):
        raise ValueError("Video ID must contain 32 lowercase hexadecimal characters")
    return VIDEO_DIR / (video_id + ".mp4")


@mcp.tool()
async def account_and_post_options() -> dict:
    """Check TikTok creator username, privacy choices, duration and audit status."""
    creator = await api("/v2/post/publish/creator_info/query/", {})
    name = creator.get("creator_username", "").lstrip("@").lower()
    if name != ACCOUNT:
        raise ValueError(f"Wrong TikTok account: expected @{ACCOUNT}, got @{name}")
    return {
        "username": name,
        "privacy_level_options": creator.get("privacy_level_options", []),
        "max_video_post_duration_sec": creator.get("max_video_post_duration_sec"),
        "app_marked_audited": AUDITED,
    }


@mcp.tool()
def list_videos() -> list[dict]:
    """List locally staged MP4 files and IDs submitted to TikTok."""
    results = []
    for p in sorted(VIDEO_DIR.glob("*.mp4")):
        if len(p.stem) != 32 or any(c not in "0123456789abcdef" for c in p.stem):
            continue
        meta = p.with_suffix(".json")
        previous = json.loads(meta.read_text()) if meta.exists() else {}
        results.append({
            "video_id": p.stem,
            "size_bytes": p.stat().st_size,
            "publish_id": previous.get("publish_id"),
        })
    return results


@mcp.tool()
async def publish_staged_video(
    video_id: str,
    caption: str,
    privacy_level: str = "SELF_ONLY",
    user_approved_this_publication: bool = False,
) -> dict:
    """Submit one MP4 after explicit authorization for this caption, file and privacy."""
    if not user_approved_this_publication:
        raise ValueError("Require explicit approval for the exact video, caption and privacy setting.")
    if not AUDITED and privacy_level != "SELF_ONLY":
        raise ValueError("Unaudited TikTok apps must use private SELF_ONLY test posts.")
    if len(caption.encode("utf-16-le")) // 2 > 2200:
        raise ValueError("Caption is too long.")
    video = validated_path(video_id)
    if not video.is_file():
        raise ValueError("Stage an MP4 in VIDEO_DIR before posting.")
    size = video.stat().st_size
    if not 0 < size <= MAX_FILE_SIZE:
        raise ValueError("Prototype accepts MP4 files up to 64 MB.")
    choices = await account_and_post_options()
    if privacy_level not in choices["privacy_level_options"]:
        raise ValueError("Privacy choice is not allowed for this TikTok creator.")
    meta = video.with_suffix(".json")
    if meta.exists() and json.loads(meta.read_text()).get("publish_id"):
        return {"already_submitted": True, "publish_id": json.loads(meta.read_text())["publish_id"]}
    data = await api("/v2/post/publish/video/init/", {
        "post_info": {
            "title": caption,
            "privacy_level": privacy_level,
            "disable_comment": False,
            "disable_duet": False,
            "disable_stitch": False,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": size,
            "chunk_size": size,
            "total_chunk_count": 1,
        },
    })
    publish_id, upload_url = data.get("publish_id"), data.get("upload_url")
    if not publish_id or not upload_url:
        raise RuntimeError("TikTok did not provide upload metadata.")
    parsed = urlparse(upload_url)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not (host == "tiktokapis.com" or host.endswith(".tiktokapis.com")):
        raise RuntimeError("Refusing untrusted upload URL.")
    # Persist immediately to prevent duplicate submissions when retries occur.
    meta.write_text(json.dumps({"publish_id": publish_id, "started_at": int(time.time())}))
    async with httpx.AsyncClient(timeout=180, follow_redirects=False) as client:
        with video.open("rb") as f:
            response = await client.put(
                upload_url,
                content=f.read(),
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Range": f"bytes 0-{size-1}/{size}",
                },
            )
    if response.status_code not in (201, 206):
        raise RuntimeError(f"Video transfer HTTP {response.status_code}. Check status; do not retry blindly.")
    return {
        "submitted": True,
        "published": False,
        "publish_id": publish_id,
        "next_step": "Call check_publication; upload is not proof of publication.",
    }


@mcp.tool()
async def check_publication(publish_id: str) -> dict:
    """Fetch TikTok's real status; return public URL only if TikTok confirms."""
    info = await api("/v2/post/publish/status/fetch/", {"publish_id": publish_id})
    state = info.get("status", "UNKNOWN")
    public_ids = info.get("publicaly_available_post_id") or []
    return {
        "status": state,
        "published": state == "PUBLISH_COMPLETE",
        "failure_reason": info.get("fail_reason"),
        "public_url": (
            f"https://www.tiktok.com/@{ACCOUNT}/video/{public_ids[0]}"
            if state == "PUBLISH_COMPLETE" and public_ids else None
        ),
    }


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
