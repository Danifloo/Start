/**
 * GoNews Publisher - TikTok OAuth connection backend (Cloudflare Worker).
 * Informational prototype: connects account securely but does not post videos.
 * Sensitive values are stored in Worker secrets, never GitHub.
 */

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const CREATOR_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const PROFILE_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name";

class OAuthStepError extends Error {
  constructor(step, providerCode = "unknown") {
    super(step + ":" + providerCode);
    this.step = step;
    this.providerCode = providerCode;
  }
}

// TikTok error descriptions may contain account-related values, so only
// allow known public OAuth error codes into browser-visible diagnostics.
function safeTikTokErrorCode(value) {
  const allowed = new Set([
    "invalid_client", "invalid_grant", "invalid_request", "invalid_scope",
    "unauthorized_client", "access_denied", "server_error",
    "temporarily_unavailable", "unsupported_grant_type", "invalid_token",
    "scope_not_authorized", "scope_permission_missed", "rate_limit_exceeded",
    // Exception *types*, not exception messages (which may contain sensitive data).
    "TypeError", "AbortError", "TimeoutError",
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "other";
}

function oauthFinish(req, step, reason = "") {
  // The callback URL contains a sensitive one-time authorization code.
  // Always redirect to a clean result URL before showing the outcome.
  const target = new URL("/result", req.url);
  target.searchParams.set("step", step);
  if (reason) target.searchParams.set("reason", reason);
  return new Response(null, { status: 303, headers: {
    Location: target.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": "gns_state=; Path=/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  } });
}

function oauthResult(req) {
  const url = new URL(req.url);
  const step = url.searchParams.get("step") || "unknown";
  const reason = safeTikTokErrorCode(url.searchParams.get("reason"));
  if (step === "connected_sandbox") {
    return textResponse("CONNECTED: TikTok Sandbox Login Kit authorization succeeded. No public publishing rights have been granted.");
  }
  if (step === "connected_production") {
    return textResponse("CONNECTED: TikTok production authorization succeeded.");
  }
  const labels = {
    csrf_state: "OAuth state / session mismatch",
    expired_state: "OAuth state expired",
    authorization_denied: "TikTok consent not completed",
    token_exchange: "TikTok access token exchange",
    token_network: "Connection to TikTok token API",
    token_form: "Constructing TikTok OAuth form",
    token_redirect: "Unexpected redirect from TikTok token API",
    token_response: "Unexpected token API response",
    scope: "Permission returned by TikTok",
    profile_lookup: "TikTok basic profile lookup",
    profile_network: "Connection to TikTok profile API",
    profile_response: "Unexpected profile API response",
    profile_mismatch: "TikTok account verification",
    kv_state: "Temporary OAuth state storage",
    secure_storage: "Encrypting or storing authorization",
    internal_error: "Unexpected server error",
  };
  const label = labels[step] || "Unknown OAuth stage";
  const reasonText = (step === "token_exchange" || step === "profile_lookup")
    ? " (TikTok error: " + reason + ")"
    : step === "token_network" ? " (network error type: " + reason + ")" : "";
  return textResponse("GoNews OAuth could not finish. Failed step: " + label + reasonText +
    ". Do not share any authorization code. Report only this error label to ChatGPT.", 502);
}

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
  // Encode the form before fetch. This isolates payload construction from
  // outbound network errors and avoids consuming authorization codes in probes.
  let bodyForm;
  try {
    bodyForm = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      ...data,
    });
  } catch {
    throw new OAuthStepError("token_form");
  }
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      body: bodyForm.toString(),
      // Explicit manual mode: NEVER send secrets to redirected hosts.
      // TikTok should return a direct 200/4xx JSON response.
      redirect: "manual",
    });
  } catch (error) {
    const type = error instanceof Error ? error.name : "unknown";
    const known = ["TypeError", "AbortError", "TimeoutError"].includes(type);
    throw new OAuthStepError("token_network", known ? type : "other");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new OAuthStepError("token_redirect");
  }
  let body;
  try { body = await response.json(); }
  catch { throw new OAuthStepError("token_response"); }
  if (!response.ok || !body?.access_token) {
    throw new OAuthStepError("token_exchange", safeTikTokErrorCode(body?.error));
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
  let response;
  try {
    response = await fetch(PROFILE_URL, {
      method: "GET",
      headers: { "Authorization": "Bearer " + token },
      redirect: "error",
    });
  } catch {
    throw new OAuthStepError("profile_network");
  }
  let result;
  try { result = await response.json(); }
  catch { throw new OAuthStepError("profile_response"); }
  if (!response.ok || result?.error?.code !== "ok" || !result?.data?.user?.open_id) {
    throw new OAuthStepError("profile_lookup", safeTikTokErrorCode(result?.error?.code));
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
  if (!state || !equal(state, cookie(req, "gns_state"))) {
    return oauthFinish(req, "csrf_state");
  }
  if (url.searchParams.has("error")) return oauthFinish(req, "authorization_denied");
  if (!code) return oauthFinish(req, "csrf_state");
  let recorded;
  try {
    recorded = await env.AUTH_STORE.get("oauth:" + state);
    if (recorded === "unused") await env.AUTH_STORE.delete("oauth:" + state);
  } catch {
    throw new OAuthStepError("kv_state");
  }
  if (recorded !== "unused") return oauthFinish(req, "expired_state");
  const tokens = await getTokens(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: env.TIKTOK_REDIRECT_URI,
  });
  const scopes = new Set((tokens.scope || "").split(","));
  const sandbox = env.TIKTOK_MODE === "sandbox";
  const requiredScope = sandbox ? "user.info.basic" : "video.publish";
  if (!scopes.has(requiredScope)) {
    return oauthFinish(req, "scope");
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
      return oauthFinish(req, "profile_mismatch");
    }
  } else {
    const details = await checkCreator(tokens.access_token);
    const actual = (details.creator_username || "").replace(/^@/, "").toLowerCase();
    const expected = (env.TIKTOK_ACCOUNT || "g0news1").replace(/^@/, "").toLowerCase();
    if (actual !== expected) {
      return oauthFinish(req, "profile_mismatch");
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
  try {
    await env.AUTH_STORE.put("owner:token", await seal(record, env));
  } catch {
    throw new OAuthStepError("secure_storage");
  }
  return oauthFinish(req, sandbox ? "connected_sandbox" : "connected_production");
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
 * Owner-only outbound network probe. Sends no TikTok credentials, no tokens,
 * no OAuth codes, and does not save any results. A 4xx from TikTok is still
 * evidence that the network request reached their API.
 */
async function networkTest(req, env) {
  const adminError = checkAdminSettings(env);
  if (adminError) return adminError;
  if (!isOwner(req, env)) return requireOwner();

  const checks = [
    { name: "general_https", url: "https://example.com/", method: "GET" },
    { name: "tiktok_token_get", url: TOKEN_URL, method: "GET" },
    {
      name: "tiktok_token_post_dummy",
      url: TOKEN_URL,
      method: "POST",
      body: new URLSearchParams({
        client_key: "invalid-network-probe",
        client_secret: "invalid-network-probe",
        grant_type: "invalid-network-probe",
      }),
      redirect: "manual",
    },
    {
      name: "tiktok_token_post_dummy_redirect_error",
      url: TOKEN_URL,
      method: "POST",
      body: new URLSearchParams({
        client_key: "invalid-network-probe",
        client_secret: "invalid-network-probe",
        grant_type: "authorization_code",
        code: "invalid-network-probe",
        redirect_uri: "https://invalid.example/callback",
      }).toString(),
      redirect: "error",
    },
  ];
  const responses = await Promise.all(checks.map(async check => {
    try {
      const response = await fetch(check.url, {
        method: check.method,
        ...(check.body ? { body: check.body } : {}),
        headers: check.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
        redirect: check.redirect || "manual",
        signal: AbortSignal.timeout(8000),
      });
      // A 400/401/403/404/405 here proves connectivity; do not read body.
      try { await response.body?.cancel(); } catch {}
      return { check: check.name, connection: "reached_http_server",
        http_status: response.status,
        redirect_received: response.status >= 300 && response.status < 400 };
    } catch (error) {
      // Classify without returning arbitrary exception text that could
      // inadvertently contain private request metadata.
      const name = error instanceof Error ? error.name : "UnknownError";
      const knownNames = ["TypeError", "AbortError", "TimeoutError", "NetworkError"];
      return { check: check.name, connection: "fetch_failed",
        error_type: knownNames.includes(name) ? name : "OtherError" };
    }
  }));
  return Response.json({
    service: "GoNews outbound network test",
    sends_real_credentials: false,
    results: responses,
  }, { headers: { "Cache-Control": "no-store",
                 "Referrer-Policy": "no-referrer" } });
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

/**
 * Owner-only comparison for Sandbox Client Secret. Input is accepted over
 * HTTPS only, compared in memory and discarded. Never log or echo it.
 */
async function verifyClientSecret(req, env) {
  const adminError = checkAdminSettings(env);
  if (adminError) return adminError;
  if (!isOwner(req, env)) return requireOwner();
  if (!env.TIKTOK_CLIENT_SECRET) {
    return textResponse("TIKTOK_CLIENT_SECRET is missing from Cloudflare Secrets.", 503);
  }
  if (new URL(req.url).protocol !== "https:") {
    return textResponse("HTTPS is required.", 403);
  }

  let outcome = "";
  let matched = false;
  if (req.method === "POST") {
    // Reject large payloads, files and non-form requests. No remote TikTok
    // calls are made by this endpoint.
    const size = req.headers.get("Content-Length");
    if (size && (!/^\\d+$/.test(size) || Number(size) > 2048)) {
      return textResponse("Form is too large.", 413);
    }
    if (!(req.headers.get("Content-Type") || "").toLowerCase()
      .startsWith("application/x-www-form-urlencoded")) {
      return textResponse("Expected a form submission.", 415);
    }
    const input = await req.text();
    if (input.length > 2048) return textResponse("Form is too large.", 413);
    const params = new URLSearchParams(input);
    const submitted = params.get("client_secret");
    if (!submitted || submitted.length > 512) {
      outcome = "Please paste the complete Sandbox Client Secret.";
    } else if (equal(submitted, env.TIKTOK_CLIENT_SECRET)) {
      matched = true;
      outcome = "MATCH: Sandbox Client Secret is identical to the one in Cloudflare.";
    } else if (equal(submitted.trim(), env.TIKTOK_CLIENT_SECRET.trim())) {
      outcome = "WHITESPACE ERROR: One value contains extra spaces or line breaks. Replace Cloudflare's TIKTOK_CLIENT_SECRET with the exact Sandbox value.";
    } else {
      outcome = "DOES NOT MATCH: Cloudflare contains a different Client Secret. Update TIKTOK_CLIENT_SECRET in Cloudflare with the Sandbox Client Secret.";
    }
  }

  const style = "body{max-width:640px;margin:36px auto;padding:0 20px;font:17px system-ui,sans-serif;line-height:1.55;background:#10141b;color:#fff}"
    + "main{border:1px solid #4b5360;border-radius:14px;padding:24px}"
    + "input{box-sizing:border-box;width:100%;padding:13px;margin-top:10px;font-size:16px;border-radius:8px}"
    + "button{padding:12px 20px;background:#ffd500;border:0;border-radius:8px;font-size:16px;font-weight:bold;margin-top:18px}"
    + ".result{font-weight:bold;margin-top:18px;color:" + (matched ? "#8ae6ab" : "#ffdd85") + "}";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GoNews — Verificar Client Secret</title><style>${style}</style></head>
<body><main><h1>GoNews Publisher</h1><h2>Verificar Client Secret de Sandbox</h2>
<p>Esta página compara el valor enviado directamente con el secreto guardado en tu Worker de Cloudflare. No muestra ni guarda los secretos, ni los envía a ChatGPT o a TikTok.</p>
<form method="post" action="/verify-client-secret">
<label for="secret">Pega el <strong>Client Secret</strong> de <strong>GoNews Test → Sandbox → Credentials</strong>:</label>
<input id="secret" type="password" name="client_secret" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="512">
<button type="submit">Comparar secretos</button></form>
<p class="result" role="status">${outcome}</p>
<p>Si aparece DOES NOT MATCH o WHITESPACE ERROR, actualiza la variable <code>TIKTOK_CLIENT_SECRET</code> en Cloudflare (tipo Secret). No compartas este valor por chat ni en capturas.</p>
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
      if (url.pathname === "/result" && req.method === "GET") return oauthResult(req);
      if (url.pathname === "/status" && req.method === "GET") return await status(req, env);
      if (url.pathname === "/diagnostics" && req.method === "GET") return await diagnostics(req, env);
      if (url.pathname === "/network-test" && req.method === "GET") return await networkTest(req, env);
      if (url.pathname === "/verify-client-key" && ["GET", "POST"].includes(req.method)) return await verifyClientKey(req, env);
      if (url.pathname === "/verify-client-secret" && ["GET", "POST"].includes(req.method)) return await verifyClientSecret(req, env);
      return textResponse("Not found", 404);
    } catch (err) {
      // Never log TikTok private values, authorization codes or tokens.
      const url = new URL(req.url);
      if (url.pathname === "/callback" && req.method === "GET") {
        return oauthFinish(req,
          err instanceof OAuthStepError ? err.step : "internal_error",
          err instanceof OAuthStepError ? err.providerCode : "");
      }
      console.error("GoNews request failed in " + url.pathname);
      return textResponse("Service configuration incomplete or request failed.", 503);
    }
  },
};
