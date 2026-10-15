import test from "node:test";
import assert from "node:assert/strict";
import worker, { isQuarterHour, isPublicHttps, validatePost, processQueue } from "../src/index.js";

const SECRET = "very-long-test-session-secret-32-characters";
const PASSWORD = "secure-test-admin-password";
const origin = "https://m2-publisher.example.workers.dev";
function validPost() {
  return {
    story_key: "nasa-telescopio-octubre-2026",
    title: "Un telescopio detecta nuevos detalles en el espacio",
    caption: "Descripción verificada de la noticia con contexto original y fuentes fiables.",
    source_url: "https://nasa.gov/some-valid-story",
    source_date: "2026-10-15",
    rights: "NASA public domain; verificar el crédito de cada foto.",
    images: [
      "https://images.nasa.gov/photo1.jpg",
      "https://images.nasa.gov/photo2.jpg",
      "https://images.nasa.gov/photo3.jpg"
    ],
    scheduled_at: "2026-10-16T10:15:00.000Z"
  };
}
function env(db = {}) {
  return { ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, DB: db,
    PUBLISHING_ENABLED: "false", IG_EXPECTED_USERNAME: "maqued2" };
}
function request(path, method = "GET", payload, options = {}) {
  const headers = { ...options.headers };
  if (method === "POST") {
    headers.Origin = options.origin || origin;
    headers["Content-Type"] = "application/json";
  }
  return new Request(origin + path, { method, headers, body: payload ? JSON.stringify(payload) : (method === "POST" ? "{}" : undefined) });
}

test("minute slots accept every 15 minutes including New York DST shifts", () => {
  assert.equal(isQuarterHour("2026-10-15T11:00:00.000Z"), true);
  assert.equal(isQuarterHour("2026-10-15T11:45:00.000Z"), true);
  assert.equal(isQuarterHour("2026-11-01T06:15:00.000Z"), true);
  assert.equal(isQuarterHour("2026-10-15T11:05:00.000Z"), false);
  assert.equal(isQuarterHour("2026-10-15T11:15:01.000Z"), false);
});
test("public HTTPS validation rejects local/private and insecure addresses", () => {
  assert.equal(isPublicHttps("https://images.nasa.gov/example.jpg"), true);
  for (const url of ["http://nasa.gov/image", "https://localhost/a", "https://127.0.0.1/a", "https://10.0.0.2/a", "https://192.168.1.5/a", "https://172.20.0.1/a", "https://evil.local/a"]) {
    assert.equal(isPublicHttps(url), false, url);
  }
});
test("editorial guard enforces three different licensed images and one quarter-hour slot", () => {
  const valid = validatePost(validPost(), Date.parse("2026-10-15T00:00:00.000Z"));
  assert.equal(valid.images.length, 3);
  const duplicates = validPost();
  duplicates.images[1] = duplicates.images[0];
  assert.throws(() => validatePost(duplicates, Date.parse("2026-10-15T00:00:00.000Z")), /tres im.genes/i);
  const incorrect = validPost();
  incorrect.scheduled_at = "2026-10-16T10:01:00.000Z";
  assert.throws(() => validatePost(incorrect, Date.parse("2026-10-15T00:00:00.000Z")), /horario futuro/i);
  const noRights = validPost();
  noRights.rights = "";
  assert.throws(() => validatePost(noRights, Date.parse("2026-10-15T00:00:00.000Z")), /permiso/i);
});
test("health endpoint never reports publishing as active", async () => {
  const r = await worker.fetch(request("/health"), {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok" });
});
test("unconfigured application refuses dashboard and mutation requests", async () => {
  const r = await worker.fetch(request("/"), {});
  assert.equal(r.status, 503);
  const m = await worker.fetch(request("/api/posts", "POST", validPost()), {});
  assert.equal(m.status, 503);
});
test("login sets secure session cookie and allows private dashboard", async () => {
  const wrong = await worker.fetch(request("/api/login", "POST", { password: "wrong" }), env());
  assert.equal(wrong.status, 401);
  const right = await worker.fetch(request("/api/login", "POST", { password: PASSWORD }), env());
  assert.equal(right.status, 200);
  const cookie = right.headers.get("set-cookie");
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const dashboard = await worker.fetch(request("/", "GET", null, { headers: { Cookie: cookie.split(";")[0] } }), env());
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Centro editorial|sala de control/);
});
test("POST API forbids requests from untrusted origins", async () => {
  const requestFromEvil = new Request(origin + "/api/login", {
    method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD })
  });
  const r = await worker.fetch(requestFromEvil, env());
  assert.equal(r.status, 403);
});
test("scheduled task never creates posts while publishing disabled", async () => {
  const result = await processQueue(env({}), Date.parse("2026-10-15T12:00:00Z"));
  assert.deepEqual(result, { disabled: true });
});
