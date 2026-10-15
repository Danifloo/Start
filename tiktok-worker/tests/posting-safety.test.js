import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import worker from "../src/index.js";
import { publishingEnabled, validatePostSettings, mp4Duration } from "../src/posting-policy.js";
import { publishingPanel } from "../src/publishing-panel.js";

const origin = "https://test.example";
const admin = { ADMIN_USERNAME: "fake-owner", ADMIN_PASSWORD: "fake-password-for-tests" };
const authorization = "Basic " + btoa(admin.ADMIN_USERNAME + ":" + admin.ADMIN_PASSWORD);
const creator = { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], max_video_post_duration_sec: 60 };
function settings(extra = {}) {
  return new URLSearchParams({ title: "My original video", privacy_level: "SELF_ONLY", consent: "yes", music_consent: "yes", ...extra });
}
function movie(seconds, version = 0) {
  const payload = new Uint8Array(version === 1 ? 32 : 20);
  const view = new DataView(payload.buffer); view.setUint8(0, version);
  const at = version === 1 ? 20 : 12; view.setUint32(at, 1000);
  if (version === 1) view.setBigUint64(at + 4, BigInt(seconds * 1000));
  else view.setUint32(at + 4, seconds * 1000);
  function box(type, data) {
    const output = new Uint8Array(8 + data.length); new DataView(output.buffer).setUint32(0, output.length);
    output.set(new TextEncoder().encode(type), 4); output.set(data, 8); return output;
  }
  return box("moov", box("mvhd", payload)).buffer;
}

test("publishing needs both exact production mode and explicit activation", () => {
  assert.equal(publishingEnabled({}), false);
  assert.equal(publishingEnabled({ TIKTOK_MODE: "sandbox", PUBLISHING_ENABLED: "true" }), false);
  assert.equal(publishingEnabled({ TIKTOK_MODE: "production", PUBLISHING_ENABLED: "false" }), false);
  assert.equal(publishingEnabled({ TIKTOK_MODE: "production", PUBLISHING_ENABLED: "true" }), true);
});

test("Sandbox and disabled Production reject uploads before reading tokens or making network calls", async t => {
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw Error("No networking allowed"); });
  for (const TIKTOK_MODE of ["sandbox", "production"]) {
    for (const PUBLISHING_ENABLED of [undefined, "false"]) {
      const env = { ...admin, TIKTOK_MODE, PUBLISHING_ENABLED, AUTH_STORE: { get() { throw Error("Must not read token"); } } };
      const req = new Request(origin + "/submit-video", { method: "POST", headers: { Authorization: authorization, Origin: origin } });
      assert.equal((await worker.fetch(req, env)).status, 403);
    }
  }
  assert.equal(calls, 0);
});

test("authenticated cross-origin submission is rejected before reading tokens", async () => {
  const req = new Request(origin + "/submit-video", { method: "POST", headers: { Authorization: authorization, Origin: "https://other.example" } });
  const env = { ...admin, TIKTOK_MODE: "production", PUBLISHING_ENABLED: "true", AUTH_STORE: { get() { throw Error("Must not read token"); } } };
  assert.equal((await worker.fetch(req, env)).status, 403);
});

test("private status, configuration and publisher routes require authentication", async () => {
  for (const path of ["/status", "/diagnostics", "/posting-readiness", "/publish", "/creator-options", "/posting-status?id=test"]) {
    const r = await worker.fetch(new Request(origin + path), admin);
    assert.equal(r.status, 401, path); assert.match(r.headers.get("WWW-Authenticate"), /Basic/);
  }
});

test("local readiness never claims approval or exposes credentials", async () => {
  const req = new Request(origin + "/posting-readiness", { headers: { Authorization: authorization } });
  const r = await worker.fetch(req, { ...admin, TIKTOK_MODE: "sandbox" }); const text = await r.text(); const result = JSON.parse(text);
  assert.equal(result.publishing_enabled, false);
  assert.equal(result.production_approval, "not_verified_by_this_endpoint");
  assert.ok(!text.includes(admin.ADMIN_PASSWORD)); assert.equal(r.headers.get("Cache-Control"), "no-store");
});

test("privacy has to match current creator options", () => {
  assert.throws(() => validatePostSettings(settings({ privacy_level: "" }), creator), /privacidad/);
  assert.throws(() => validatePostSettings(settings({ privacy_level: "MUTUAL_FOLLOW_FRIENDS" }), creator), /privacidad/);
});

test("interactions default off and creator restrictions always win", () => {
  const defaults = validatePostSettings(settings(), creator);
  assert.equal(defaults.disable_comment, true); assert.equal(defaults.disable_duet, true); assert.equal(defaults.disable_stitch, true);
  const restricted = validatePostSettings(settings({ allow_comment: "true", allow_duet: "true", allow_stitch: "true" }), { ...creator, comment_disabled: true, duet_disabled: true, stitch_disabled: true });
  assert.equal(restricted.disable_comment, true); assert.equal(restricted.disable_duet, true); assert.equal(restricted.disable_stitch, true);
  assert.equal(validatePostSettings(settings({ allow_comment: "true" }), creator).disable_comment, false);
});

test("posting and music consent are both mandatory", () => {
  assert.throws(() => validatePostSettings(settings({ consent: "no" }), creator), /Confirma/);
  assert.throws(() => validatePostSettings(settings({ music_consent: "no" }), creator), /Confirma/);
});

test("commercial disclosure requires a selected brand category", () => {
  assert.throws(() => validatePostSettings(settings({ commercial_content: "true" }), creator), /Indica/);
  assert.throws(() => validatePostSettings(settings({ own_brand: "true" }), creator), /Activa/);
  const result = validatePostSettings(settings({ commercial_content: "true", own_brand: "true" }), creator);
  assert.equal(result.brand_organic_toggle, true); assert.equal(result.brand_content_toggle, false);
});

test("paid partnerships cannot be private and require separate consent", () => {
  const commercial = { commercial_content: "true", branded_content: "true" };
  assert.throws(() => validatePostSettings(settings({ ...commercial, branded_consent: "yes" }), creator), /visibilidad/);
  assert.throws(() => validatePostSettings(settings({ ...commercial, privacy_level: "PUBLIC_TO_EVERYONE" }), creator), /visibilidad/);
  assert.equal(validatePostSettings(settings({ ...commercial, privacy_level: "PUBLIC_TO_EVERYONE", branded_consent: "yes" }), creator).brand_content_toggle, true);
});

test("actual MP4 duration is read from both movie-header versions", () => {
  assert.equal(mp4Duration(movie(55)), 55); assert.equal(mp4Duration(movie(120, 1)), 120);
});

test("malformed, missing and undefined movie durations are rejected", () => {
  assert.throws(() => mp4Duration(new ArrayBuffer(0)), /duración/);
  const truncated = movie(55).slice(0, 12); assert.throws(() => mp4Duration(truncated), /MP4/);
  assert.throws(() => mp4Duration(movie(0)), /duración/);
});

test("publisher embedded JavaScript parses and initial submit is disabled", async () => {
  const response = publishingPanel(); const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Script(script));
  assert.match(html, /id="send"[^>]*disabled/);
  assert.match(html, /<option value="">/);
  assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self'/);
});
