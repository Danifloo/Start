/**
 * GoNews Publisher - TikTok OAuth connection backend (Cloudflare Worker).
 * Informational prototype: connects account securely but does not post videos.
 * Sensitive values are stored in Worker secrets, never GitHub.
 */

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const CREATOR_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

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
    const decoded = atob(authorization.slice(6));
    const colon = decoded.indexOf(":");
    return colon > 0 && equal(decoded.slice(0, colon), env.ADMIN_USERNAME) &&
      equal(decoded.slice(colon + 1), env.ADMIN_PASSWORD);
  } catch {
    return false;
  }
}

function requireOwner() {
  return textResponse("Owner sign-in required", 401, {
    "WWW-Authenticate": 'Basic realm="GoNews Publisher"',
  });
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

async function connect(req, env) {
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
    scope: "user.info.basic,video.publish",
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
  if (!scopes.has("video.publish")) {
    return textResponse("TikTok authorization did not include video.publish.", 403);
  }
  const details = await checkCreator(tokens.access_token);
  const actual = (details.creator_username || "").replace(/^@/, "").toLowerCase();
  const expected = (env.TIKTOK_ACCOUNT || "g0news1").replace(/^@/, "").toLowerCase();
  if (actual !== expected) {
    return textResponse("Wrong account. Connect @" + expected + " instead.", 403);
  }
  const record = {
    username: actual,
    open_id: tokens.open_id,
    scopes: tokens.scope,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    refresh_expires_at: Date.now() + (tokens.refresh_expires_in || 0) * 1000,
  };
  await env.AUTH_STORE.put("owner:token", await seal(record, env));
  return textResponse("TikTok @" + actual + " connected. Return to ChatGPT.", 200, {
    "Set-Cookie": "gns_state=; Path=/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  });
}

async function status(req, env) {
  if (!isOwner(req, env)) return requireOwner();
  validateEnv(env);
  const item = await env.AUTH_STORE.get("owner:token");
  if (!item) return Response.json({ connected: false }, { headers: { "Cache-Control": "no-store" } });
  const user = await unseal(item, env);
  return Response.json({
    connected: true, username: user.username,
    scopes: user.scopes, token_expired: Date.now() >= user.expires_at,
    refresh_expired: Date.now() >= user.refresh_expires_at,
  }, { headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json({ ok: true, service: "GoNews TikTok OAuth" });
      }
      if (url.pathname === "/connect" && req.method === "GET") return connect(req, env);
      if (url.pathname === "/callback" && req.method === "GET") return callback(req, env);
      if (url.pathname === "/status" && req.method === "GET") return status(req, env);
      return textResponse("Not found", 404);
    } catch (err) {
      // Never log TikTok secret credentials, callback codes, or OAuth tokens.
      console.error("GoNews OAuth error:", err instanceof Error ? err.message : "unknown");
      return textResponse("Service configuration incomplete or TikTok authorization failed.", 503);
    }
  },
};
