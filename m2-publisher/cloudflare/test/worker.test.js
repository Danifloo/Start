import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{scheduledCycle} from '../src/worker.js';
import {newSession,sessionCookie} from '../src/auth.js';
const env={ADMIN_PASSWORD:'my-secure-panel-password-000',SESSION_SECRET:'A'.repeat(64),IG_EXPECTED_USERNAME:'maqued2',ENABLE_PUBLISHING:'false'};
function mockDB() {
  const stmt = {
    async run() { return {success:true}; },
    async first() { return null; },
    async all() { return {results:[]}; },
    bind() { return this; }
  };
  return { prepare() { return stmt; } };
}
test('health endpoint and private dashboard are reachable without Instagram keys',async()=>{
  const r=await handler.fetch(new Request('https://example.workers.dev/health'),{...env,DB:mockDB()});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{status:'ok'});
  const page=await handler.fetch(new Request('https://example.workers.dev/'),{...env,DB:mockDB()});
  assert.match(await page.text(),/M2.*PUBLISHER/s);
});
test('private API denies anonymous access',async()=>{
  const r=await handler.fetch(new Request('https://example.workers.dev/api/posts'),{...env,DB:mockDB()});
  assert.equal(r.status,401);
});
test('quarter-hour scheduled handler never publishes when mode is disabled',async()=>{
  const r=await scheduledCycle({...env,DB:mockDB()},Date.parse('2026-10-15T18:15:00Z'));
  assert.deepEqual(r,{action:'PUBLISHING_DISABLED'});
});
test('session-authenticated status reflects safe mode',async()=>{
  const token=await newSession(env);
  const r=await handler.fetch(new Request('https://example.workers.dev/api/status',{headers:{Cookie:sessionCookie(token)}}),{...env,DB:mockDB()});
  assert.equal(r.status,200);
  const out=await r.json();
  assert.equal(out.publishing_enabled,false);
  assert.equal(out.r2_configured,false);
});
