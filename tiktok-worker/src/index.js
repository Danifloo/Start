/**
 * GoNews Publisher - TikTok OAuth connection backend (Cloudflare Worker).
 * Informational prototype: connects account securely but does not post videos.
 * Sensitive values are stored in Worker secrets, never GitHub.
 */

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const CREATOR_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const PROFILE_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name";

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  } });
}

function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function isOwner(req, env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return false;
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Basic ")) return false;
  try {
    // Basic Auth transports UTF-8 credentials as Base64 bytes. Decoding
    // with atob alone produces Latin-1 text and rejects accented passwords.
    const raw = atob(authorization.slice(6).trim());
    const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const colon = decoded.indexOf(":");
    return colon > 0 && equal(decoded.slice(0, colon), env.ADMIN_USERNAME) &&
      equal(decoded.slice(colon + 1), env.ADMIN_PASSWORD);
  } catch {
    return false;
  }
}

function requireOwner() {
  return textResponse("Owner sign-in required", 401, {
    "WWW-Authenticate": 'Basic realm="GoNews Publisher", charset="UTF-8"',
  });
}

function checkAdminSettings(env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return textResponse("Administrator credentials are not configured in Cloudflare Worker secrets.", 503);
  }
  return null;
}

function cookie(req, key) {
  const result = {};
  for (const pair of (req.headers.get("Cookie") || "").split(";")) {
    const pos = pair.indexOf("=");
    if (pos >= 0) result[pair.slice(0, pos).trim()] = pair.slice(pos + 1).trim();
  }
  return result[key] || "";
}

function bytesToBase64(bytes) {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw);
}
function base64ToBytes(encoded) {
  return Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
}

async function keyFromEnv(env) {
  const encoded = env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Missing encryption key");
  const key = base64ToBytes(encoded);
  if (key.length !== 32) throw new Error("Encryption key must be 32 random bytes encoded as base64");
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value, env) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await keyFromEnv(env), data);
  return JSON.stringify({ iv: bytesToBase64(nonce), data: bytesToBase64(new Uint8Array(encrypted)) });
}

async function unseal(json, env) {
  const record = JSON.parse(json);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(record.iv) },
    await keyFromEnv(env),
    base64ToBytes(record.data),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}

function validateEnv(env) {
  const required = [
    "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI",
    "ADMIN_USERNAME", "ADMIN_PASSWORD", "TOKEN_ENCRYPTION_KEY",
  ];
  const missing = required.filter(name => !env[name]);
  if (!env.AUTH_STORE) missing.push("AUTH_STORE KV binding");
  if (missing.length) throw new Error("Missing configuration: " + missing.join(", "));
  const redirect = new URL(env.TIKTOK_REDIRECT_URI);
  if (redirect.protocol !== "https:" || redirect.pathname !== "/callback" ||
      redirect.search || redirect.hash) {
    throw new Error("Redirect URI must use HTTPS and end in /callback");
  }
}

async function getTokens(env, data) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      ...data,
    }),
    redirect: "error",
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error("TikTok denied token exchange (" + (body.error || response.status) + ")");
  }
  return body;
}

async function checkCreator(token) {
  const response = await fetch(CREATOR_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: "{}",
    redirect: "error",
  });
  const body = await response.json();
  if (!response.ok || body.error?.code !== "ok") {
    throw new Error("Cannot verify TikTok account (" + (body.error?.code || response.status) + ")");
  }
  return body.data;
}

async function getBasicProfile(token) {
  const response = await fetch(PROFILE_URL, {
    method: "GET",
    headers: { "Authorization": "Bearer " + token },
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok || result.error?.code !== "ok" || !result.data?.user?.open_id) {
    throw new Error("Cannot retrieve TikTok basic profile (" + (result.error?.code || response.status) + ")");
  }
  return result.data.user;
}

async function connect(req, env) {
  const adminError = checkAdminSettings(env);
  if (adminError) return adminError;
  if (!isOwner(req, env)) return requireOwner();
  validateEnv(env);
  const requestUrl = new URL(req.url);
  if (new URL(env.TIKTOK_REDIRECT_URI).origin !== requestUrl.origin) {
    return textResponse("The redirect URI must use this Worker's deployed HTTPS hostname.", 503);
  }
  const raw = crypto.getRandomValues(new Uint8Array(24));
  const state = bytesToBase64(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  await env.AUTH_STORE.put("oauth:" + state, "unused", { expirationTtl: 600 });
  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    response_type: "code",
    // TikTok Sandbox does not offer Content Posting API. Only test Login Kit.
    scope: env.TIKTOK_MODE === "sandbox" ? "user.info.basic" : "user.info.basic,video.publish",
    redirect_uri: env.TIKTOK_REDIRECT_URI,
    state,
  });
  const redirect = AUTH_URL + "?" + params.toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirect,
      "Set-Cookie": "gns_state=" + state +
        "; Path=/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
      "Cache-Control": "no-store",
    },
  });
}

async function callback(req, env) {
  validateEnv(env);
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!state || !code || !equal(state, cookie(req, "gns_state"))) {
    return textResponse("Invalid or missing TikTok authorization. Restart at /connect.", 400);
  }
  const recorded = await env.AUTH_STORE.get("oauth:" + state);
  if (recorded !== "unused") return textResponse("Authorization expired. Restart at /connect.", 400);
  await env.AUTH_STORE.delete("oauth:" + state);
  const tokens = await getTokens(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: env.TIKTOK_REDIRECT_URI,
  });
  const scopes = new Set((tokens.scope || "").split(","));
  const sandbox = env.TIKTOK_MODE === "sandbox";
  const requiredScope = sandbox ? "user.info.basic" : "video.publish";
  if (!scopes.has(requiredScope)) {
    return textResponse("TikTok authorization did not grant the requested scope.", 403);
  }
  let username = null;
  let displayName = null;
  let accountVerified = false;
  if (sandbox) {
    // Basic scope never proves the user's TikTok @handle. Do not claim
    // to have validated @g0news1 or activated video publishing.
    const profile = await getBasicProfile(tokens.access_token);
    displayName = profile.display_name || null;
    if (profile.open_id !== tokens.open_id) {
      return textResponse("TikTok account verification mismatch.", 403);
    }
  } else {
    const details = await checkCreator(tokens.access_token);
    const actual = (details.creator_username || "").replace(/^@/, "").toLowerCase();
    const expected = (env.TIKTOK_ACCOUNT || "g0news1").replace(/^@/, "").toLowerCase();
    if (actual !== expected) {
      return textResponse("Wrong account. Connect @" + expected + " instead.", 403);
    }
    username = actual;
    accountVerified = true;
  }
  const record = {
    username, display_name: displayName, account_verified: accountVerified,
    mode: sandbox ? "sandbox" : "production",
    open_id: tokens.open_id,
    scopes: tokens.scope,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    refresh_expires_at: Date.now() + (tokens.refresh_expires_in || 0) * 1000,
  };
  await env.AUTH_STORE.put("owner:token", await seal(record, env));
  const message = sandbox
    ? "TikTok Sandbox Login Kit authorized. This is NOT public publishing access. Return to ChatGPT."
    : "TikTok @" + username + " connected. Return to ChatGPT.";
  return textResponse(message, 200, {
    "Set-Cookie": "gns_state=; Path=/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  });
}

async function status(req, env) {
  const adminError = checkAdminSettings(env);
  if (adminError) return adminError;
  if (!isOwner(req, env)) return requireOwner();
  validateEnv(env);
  const item = await env.AUTH_STORE.get("owner:token");
  if (!item) return Response.json({ connected: false }, { headers: { "Cache-Control": "no-store" } });
  const user = await unseal(item, env);
  return Response.json({
    connected: true, username: user.username, display_name: user.display_name || null,
    account_verified: user.account_verified === true, mode: user.mode || "production",
    scopes: user.scopes, token_expired: Date.now() >= user.expires_at,
    refresh_expired: Date.now() >= user.refresh_expires_at,
  }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Private, read-only health check for the administrator.
 * Never returns passwords, tokens, keys or their lengths.
 */
async function diagnostics(req, env) {
  const adminError = checkAdminSettings(env);
  if (adminError) return adminError;
  if (!isOwner(req, env)) return requireOwner();

  const required = [
    "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET",
    "TIKTOK_REDIRECT_URI", "ADMIN_USERNAME",
    "ADMIN_PASSWORD", "TOKEN_ENCRYPTION_KEY",
  ];
  const missing = required.filter(name => !env[name]);

  let redirectStatus = "missing";
  if (env.TIKTOK_REDIRECT_URI) {
    try {
      const u = new URL(env.TIKTOK_REDIRECT_URI);
      redirectStatus = u.protocol === "https:" && u.pathname === "/callback" &&
        u.origin === new URL(req.url).origin && !u.search && !u.hash
        ? "ok" : "incorrect";
    } catch {
      redirectStatus = "incorrect";
    }
  }

  let encryptionStatus = "missing";
  if (env.TOKEN_ENCRYPTION_KEY) {
    try {
      await keyFromEnv(env);
      encryptionStatus = "ok";
    } catch {
      encryptionStatus = "invalid_format";
    }
  }

  let kvStatus = "missing";
  if (env.AUTH_STORE && typeof env.AUTH_STORE.get === "function") {
    try {
      await env.AUTH_STORE.get("gonews:diagnostic:absent-key");
      kvStatus = "ok";
    } catch {
      kvStatus = "unavailable";
    }
  }

  return Response.json({
    missing_variable_names: missing,
    redirect_uri: redirectStatus,
    token_encryption_key: encryptionStatus,
    auth_store: kvStatus,
    mode: env.TIKTOK_MODE === "sandbox" ? "sandbox" : "production",
    requested_scopes: env.TIKTOK_MODE === "sandbox" ? "user.info.basic" : "user.info.basic,video.publish",
    ready: missing.length === 0 && redirectStatus === "ok" &&
      encryptionStatus === "ok" && kvStatus === "ok",
  }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Owner-only comparison of the public TikTok client key with the value
 * deployed in Cloudflare. Never display, store, or log either value.
 */
async function verifyClientKey(req, env) {
  const adminError = checkAdminSettings(env);
  if (adminError) return adminError;
  if (!isOwner(req, env)) return requireOwner();
  if (!env.TIKTOK_CLIENT_KEY) return textResponse("TIKTOK_CLIENT_KEY is not configured.", 503);
  let message = "Copy the Sandbox Client key directly from TikTok Developers and paste it below.";
  let matched = false;
  if (req.method === "POST") {
    if (Number(req.headers.get("Content-Length") || 0) > 2048) {
      return textResponse("Form is too large.", 413);
    }
    const form = await req.formData();
    const provided = form.get("client_key");
    if (typeof provided !== "string" || provided.length < 4 || provided.length > 128) {
      message = "Invalid client key input. Copy the complete key from TikTok.";
    } else if (equal(provided, env.TIKTOK_CLIENT_KEY)) {
      matched = true;
      message = "MATCH: The key in TikTok Developers is identical to the key saved in Cloudflare.";
    } else if (equal(provided.trim(), env.TIKTOK_CLIENT_KEY.trim())) {
      message = "WHITESPACE ERROR: One of the keys contains extra spaces or line breaks. Copy it again without whitespace.";
    } else {
      message = "DOES NOT MATCH: The key saved in Cloudflare differs from the one shown in TikTok Developers.";
    }
  }
  const mode = env.TIKTOK_MODE === "sandbox" ? "Sandbox login-only" : "Production";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GoNews · Verify Client Key</title>
<style>body{max-width:680px;margin:40px auto;padding:0 22px;font:17px system-ui,sans-serif;line-height:1.5;background:#10141b;color:white}
main{border:1px solid #465466;padding:24px;border-radius:14px}label{display:block;margin-top:24px}
input{box-sizing:border-box;width:100%;font:17px system-ui;padding:12px;background:#fff;color:#111;border:2px solid #67788c;border-radius:8px}
button{display:block;padding:12px 19px;margin-top:20px;background:#ffd500;color:#111;font-size:17px;font-weight:700;border:0;border-radius:8px}
strong{display:block;margin-top:20px;color:${matched ? "#73e5a0" : "#ffe29a"}}small{color:#b9c7d7}</style>
</head><body><main><h1>GoNews Publisher</h1><h2>Check TikTok Client Key</h2>
<p>Current mode: <b>${mode}</b>. This page checks the key locally with your Cloudflare Worker. It does not display the saved key or send it to ChatGPT.</p>
<form method="POST" action="/verify-client-key">
<label for="key">Paste the Client key from <b>GoNews Test → Sandbox → Credentials</b>:</label>
<input id="key" name="client_key" type="password" required minlength="4" maxlength="128" autocomplete="off" autocapitalize="none" spellcheck="false">
<button type="submit">Compare keys</button></form>
<strong role="status">${message}</strong>
<small>If MATCH appears and TikTok still reports client_key, check that Sandbox changes are applied and the target TikTok account is registered.</small>
</main></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  } });
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json({ ok: true, service: "GoNews TikTok OAuth" });
      }
      // Await async route handlers *inside* try/catch. Without await, failed
      // KV writes or misconfigured secrets cause an unhandled rejection and
      // Cloudflare Error 1101 instead of a controlled 503 response.
      if (url.pathname === "/connect" && req.method === "GET") return await connect(req, env);
      if (url.pathname === "/callback" && req.method === "GET") return await callback(req, env);
      if (url.pathname === "/status" && req.method === "GET") return await status(req, env);
      if (url.pathname === "/diagnostics" && req.method === "GET") return await diagnostics(req, env);
      if (url.pathname === "/verify-client-key" && ["GET", "POST"].includes(req.method)) return await verifyClientKey(req, env);
      return textResponse("Not found", 404);
    } catch (err) {
      // Never log TikTok secret credentials, callback codes, or OAuth tokens.
      console.error("GoNews OAuth error:", err instanceof Error ? err.message : "unknown");
      return textResponse("Service configuration incomplete or TikTok authorization failed.", 503);
    }
  },
};
