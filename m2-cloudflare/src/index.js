import { loginPage, dashboardPage } from "./ui.js";

const TZ = "America/New_York";
const API_BASE = "https://graph.instagram.com/";
const MINUTE = 60_000;
const allowedStatuses = ["QUEUED", "CLAIMED", "VERIFYING", "PUBLISHED", "QUOTA_PAUSED", "REVIEW_REQUIRED", "MISSED", "CANCELLED"];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const text = (body, status = 200) => new Response(body, {
  status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
});
const bytes = (s) => new TextEncoder().encode(s);
const encode = (array) => btoa(String.fromCharCode(...new Uint8Array(array)));
const decode = (value) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function isQuarterHour(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCMinutes() % 15 === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}
export function isPublicHttps(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return false;
    if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) return false;
    if (/^10\.|^192\.168\.|^127\.|^0\.|^169\.254\./.test(host)) return false;
    const ip = host.match(/^172\.(\d{1,3})\./);
    if (ip && Number(ip[1]) >= 16 && Number(ip[1]) <= 31) return false;
    return true;
  } catch { return false; }
}
export function validatePost(input, now = Date.now()) {
  const post = input || {};
  const title = String(post.title || "").trim();
  const caption = String(post.caption || "").trim();
  const storyKey = String(post.story_key || "").trim().toLowerCase();
  const source = String(post.source_url || "").trim();
  const sourceDate = String(post.source_date || "").trim();
  const rights = String(post.rights || "").trim();
  const images = Array.isArray(post.images) ? post.images.map(x => String(x).trim()) : [];
  const scheduledAt = new Date(post.scheduled_at);
  if (title.length < 12 || title.length > 160) throw new Error("Titular: entre 12 y 160 caracteres.");
  if (caption.length < 30 || caption.length > 2200) throw new Error("Descripción: entre 30 y 2200 caracteres.");
  if (!/^[a-z0-9][a-z0-9-]{5,119}$/.test(storyKey)) throw new Error("Clave única de noticia inválida.");
  if (!isPublicHttps(source)) throw new Error("Enlace a la fuente: HTTPS público obligatorio.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || Number.isNaN(Date.parse(sourceDate))) throw new Error("Fecha de fuente inválida.");
  if (rights.length < 12 || rights.length > 1000) throw new Error("Indica el permiso y créditos de las fotografías.");
  if (images.length !== 3 || images.some(x => !isPublicHttps(x)) || new Set(images).size !== 3) throw new Error("Se necesitan tres imágenes HTTPS reales y diferentes.");
  if (!isQuarterHour(scheduledAt) || scheduledAt.getTime() <= now + MINUTE) throw new Error("Elige un horario futuro exacto (:00, :15, :30 o :45).");
  return { title, caption, storyKey, source, sourceDate, rights, images, scheduledAt: scheduledAt.toISOString() };
}
function configReady(env) {
  return Boolean(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 16 &&
    env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 && env.DB);
}
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value)));
}
async function passwordMatches(a, b) {
  if (!a || !b) return false;
  const [x,y] = await Promise.all([digest(a), digest(b)]);
  let delta = 0;
  for(let i = 0; i < x.length; i++) delta |= x[i] ^ y[i];
  return delta === 0;
}
async function sessionSignature(secret, exp) {
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encode(await crypto.subtle.sign("HMAC", key, bytes(exp)));
}
async function authenticated(request, env) {
  if (!configReady(env)) return false;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)m2session=([0-9]+)\.([A-Za-z0-9+/=]+)/);
  if (!match || Number(match[1]) <= Date.now()) return false;
  try {
    const exp = match[1];
    const key = await crypto.subtle.importKey("raw", bytes(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, decode(match[2]), bytes(exp));
  } catch { return false; }
}
function securityHeaders(response) {
  const r = new Response(response.body, response);
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  r.headers.set("Cache-Control", "no-store");
  return r;
}
function nowISO() { return new Date().toISOString(); }
const dbFirst = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const dbRun = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
const dbAll = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).all();

async function graph(env, method, path, params = {}) {
  if (!env.IG_ACCESS_TOKEN || !env.IG_USER_ID) throw new Error("Instagram todavía no está conectado.");
  const url = new URL(API_BASE + String(env.META_GRAPH_VERSION || "v25.0") + "/" + path.replace(/^\/+/, ""));
  if (method === "GET") for (const [key,value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const init = { method, headers: { Authorization: "Bearer " + env.IG_ACCESS_TOKEN } };
  if (method === "POST") {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params);
  }
  const response = await fetch(url.toString(), init);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.error) {
    const message = result?.error?.message || ("Respuesta de Meta " + response.status);
    throw new Error("Instagram: " + String(message).slice(0,220));
  }
  return result;
}
async function verifyKnownMedia(env, row) {
  if (!row.media_id) return false;
  const data = await graph(env, "GET", row.media_id, { fields: "id,permalink" });
  const permalink = String(data.permalink || "");
  if (!/^https:\/\/(?:www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?/.test(permalink)) return false;
  await dbRun(env, "UPDATE posts SET status='PUBLISHED', permalink=?, error=NULL, updated_at=? WHERE id=? AND status='VERIFYING'",
    permalink, nowISO(), row.id);
  return true;
}
async function waitForContainer(env, container, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const r = await graph(env, "GET", container, { fields: "status_code" });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new Error("Meta rechazó el procesamiento de imagen.");
    await sleep(1400);
  }
  throw new Error("La imagen sigue procesándose. Revisar antes de reintentar para evitar duplicados.");
}
async function quotaAvailable(env) {
  const response = await graph(env, "GET", env.IG_USER_ID + "/content_publishing_limit", { fields: "quota_usage,config" });
  const info = Array.isArray(response.data) ? response.data[0] : response;
  const used = Number(info?.quota_usage);
  const total = Number(info?.config?.quota_total);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || info?.quota_usage == null || info?.config?.quota_total == null) {
    throw new Error("Meta no devolvió la cuota oficial de publicaciones; envío detenido.");
  }
  if (used >= total) return false;
  return { used, total };
}
async function sendPost(env, row) {
  const profile = await graph(env, "GET", "me", { fields: "id,username" });
  const expected = String(env.IG_EXPECTED_USERNAME || "maqued2").replace(/^@/, "").toLowerCase();
  if (String(profile.id) !== String(env.IG_USER_ID) || String(profile.username || "").toLowerCase() !== expected) {
    throw new Error("Cuenta de Instagram incorrecta: se esperaba @" + expected);
  }
  const quota = await quotaAvailable(env);
  if (!quota) {
    await dbRun(env, "UPDATE posts SET status='QUOTA_PAUSED',error=?,updated_at=? WHERE id=? AND status='CLAIMED'",
      "Límite oficial de publicaciones de Instagram agotado; cambiar horario antes de reintentar.", nowISO(), row.id);
    return;
  }
  const images = JSON.parse(row.images_json);
  const children = [];
  for (const link of images) {
    const result = await graph(env, "POST", env.IG_USER_ID + "/media", { image_url: link, is_carousel_item: "true" });
    children.push(String(result.id));
    await waitForContainer(env, String(result.id), 5);
  }
  const outer = await graph(env, "POST", env.IG_USER_ID + "/media", {
    media_type: "CAROUSEL", children: children.join(","), caption: row.caption
  });
  await dbRun(env, "UPDATE posts SET container_id=?,updated_at=? WHERE id=? AND status='CLAIMED'",
    String(outer.id), nowISO(), row.id);
  await waitForContainer(env, String(outer.id), 8);
  // Network ambiguity after media_publish cannot be auto-retried without risking duplicates.
  const result = await graph(env, "POST", env.IG_USER_ID + "/media_publish", { creation_id: String(outer.id) });
  const mediaId = String(result.id);
  await dbRun(env, "UPDATE posts SET media_id=?,status='VERIFYING',updated_at=? WHERE id=? AND status='CLAIMED'",
    mediaId, nowISO(), row.id);
  await verifyKnownMedia(env, { ...row, media_id: mediaId });
}
export async function processQueue(env, now = Date.now()) {
  if (env.PUBLISHING_ENABLED !== "true" || !env.IG_USER_ID || !env.IG_ACCESS_TOKEN) return { disabled: true };
  const iso = new Date(now).toISOString();
  const oldest = new Date(now - 15 * MINUTE).toISOString();
  // Never post yesterday's news as though it were scheduled for right now.
  await dbRun(env, "UPDATE posts SET status='MISSED', error='Horario vencido; necesita reprogramación.',updated_at=? WHERE status='QUEUED' AND scheduled_at < ?",
    iso, oldest);
  const known = await dbFirst(env, "SELECT * FROM posts WHERE status='VERIFYING' AND media_id IS NOT NULL ORDER BY scheduled_at LIMIT 1");
  if (known) {
    try { await verifyKnownMedia(env, known); }
    catch (e) { await dbRun(env, "UPDATE posts SET error=?,updated_at=? WHERE id=? AND status='VERIFYING'", String(e.message).slice(0,300), nowISO(), known.id); }
  }
  const due = await dbFirst(env, "SELECT * FROM posts WHERE status='QUEUED' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 1", iso);
  if (!due) return { processed: 0 };
  const claim = await dbRun(env, "UPDATE posts SET status='CLAIMED',updated_at=? WHERE id=? AND status='QUEUED'",
    iso, due.id);
  if (Number(claim.meta?.changes || 0) !== 1) return { processed: 0, claimed_elsewhere: true };
  try {
    await sendPost(env, due);
  } catch (e) {
    // FAILED or ambiguous response: never automatically publish this story twice.
    await dbRun(env, "UPDATE posts SET status='REVIEW_REQUIRED',error=?,updated_at=? WHERE id=? AND status='CLAIMED'",
      String(e.message || e).slice(0,300), nowISO(), due.id);
    return { processed: 1, review: true };
  }
  return { processed: 1 };
}
async function api(request, env, path) {
  if (path === "/api/login" && request.method === "POST") {
    const incoming = await request.json().catch(() => ({}));
    if (!await passwordMatches(String(incoming.password || ""), env.ADMIN_PASSWORD)) return json({ error: "Contraseña incorrecta." }, 401);
    const expiration = String(Date.now() + 7 * 24 * 3600 * 1000);
    const signature = await sessionSignature(env.SESSION_SECRET, expiration);
    const response = json({ ok: true });
    response.headers.append("Set-Cookie", "m2session=" + expiration + "." + signature + "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800");
    return response;
  }
  if (!await authenticated(request, env)) return json({ error: "Acceso privado. Inicia sesión." }, 401);
  if (path === "/api/logout" && request.method === "POST") {
    const response = json({ ok: true });
    response.headers.append("Set-Cookie", "m2session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");
    return response;
  }
  if (path === "/api/status" && request.method === "GET") {
    return json({ connected: Boolean(env.IG_USER_ID && env.IG_ACCESS_TOKEN), publishing_enabled: env.PUBLISHING_ENABLED === "true",
      username: env.IG_EXPECTED_USERNAME || "maqued2", timezone: TZ });
  }
  if (path === "/api/posts" && request.method === "GET") {
    const r = await dbAll(env, "SELECT id,story_key,title,source_url,source_date,rights,scheduled_at,status,permalink,error,created_at FROM posts ORDER BY scheduled_at DESC LIMIT 200");
    return json({ posts: r.results || [] });
  }
  if (path === "/api/posts" && request.method === "POST") {
    let post;
    try { post = validatePost(await request.json()); }
    catch(e) { return json({ error: e.message }, 422); }
    const time = nowISO();
    const id = crypto.randomUUID();
    try {
      await dbRun(env, "INSERT INTO posts(id,story_key,title,caption,source_url,source_date,rights,images_json,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'QUEUED',?,?)",
        id, post.storyKey, post.title, post.caption, post.source, post.sourceDate, post.rights,
        JSON.stringify(post.images), post.scheduledAt, time, time);
    } catch(e) {
      if (/UNIQUE constraint failed/i.test(String(e.message))) return json({ error: "La noticia o el horario ya está programado." }, 409);
      throw e;
    }
    return json({ id, status: "QUEUED", scheduled_at: post.scheduledAt }, 201);
  }
  const cancellation = path.match(/^\/api\/posts\/([0-9a-f-]{36})\/cancel$/);
  if (cancellation && request.method === "POST") {
    const result = await dbRun(env, "UPDATE posts SET status='CANCELLED',updated_at=? WHERE id=? AND status='QUEUED'",
      nowISO(), cancellation[1]);
    if (!result.meta?.changes) return json({ error: "Solo se pueden cancelar posts aún en cola." }, 409);
    return json({ ok: true });
  }
  const checking = path.match(/^\/api\/posts\/([0-9a-f-]{36})\/verify$/);
  if (checking && request.method === "POST") {
    const row = await dbFirst(env, "SELECT * FROM posts WHERE id=? AND status='VERIFYING' AND media_id IS NOT NULL", checking[1]);
    if (!row) return json({ error: "No existe un ID confirmado de Meta para verificar." }, 409);
    try { return json({ published: await verifyKnownMedia(env, row) }); }
    catch(e) { return json({ error: String(e.message).slice(0,240) }, 502); }
  }
  return json({ error: "No encontrado." }, 404);
}
async function fetchHandler(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok" });
  if (!configReady(env)) return json({ error: "Configuración privada incompleta. Consulta README." }, 503);
  if (url.pathname === "/ui.js" && request.method === "GET") return new Response("Not found", { status: 404 });
  if (url.pathname === "/style.css" && request.method === "GET") return new Response(await dashboardPage("css"), { headers: { "Content-Type": "text/css; charset=utf-8" } });
  if (url.pathname === "/app.js" && request.method === "GET") return new Response(await dashboardPage("js"), { headers: { "Content-Type": "application/javascript; charset=utf-8" } });
  if (url.pathname === "/" && request.method === "GET") {
    return text(await authenticated(request, env) ? await dashboardPage("html") : loginPage());
  }
  if (url.pathname.startsWith("/api/")) {
    if (!["GET","POST"].includes(request.method)) return json({ error: "Método no permitido." }, 405);
    if (request.method === "POST" && (!sameOrigin(request) || !request.headers.get("Content-Type")?.includes("application/json"))) {
      return json({ error: "Origen o formato no autorizado." }, 403);
    }
    return await api(request, env, url.pathname);
  }
  return json({ error: "No encontrado." }, 404);
}
export default {
  async fetch(request, env) {
    try { return securityHeaders(await fetchHandler(request, env)); }
    catch (e) { console.error("M2 error:", String(e.message).slice(0,240)); return securityHeaders(json({ error: "Error interno. Revisa los registros del servidor." }, 500)); }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(processQueue(env, Date.now()).catch(e => console.error("M2 cron failed:", String(e.message).slice(0,250))));
  }
};
