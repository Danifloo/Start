import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,validSession,passwordMatches,sessionCookie,sameOrigin} from '../src/auth.js';
const env={SESSION_SECRET:'abc'.repeat(20),ADMIN_PASSWORD:'very-long-unique-secret-123'};
test('password and signed session, expiration and tamper prevention',async()=>{
  assert.equal(await passwordMatches(env.ADMIN_PASSWORD,env),true);
  assert.equal(await passwordMatches('incorrect',env),false);
  const now=Date.parse('2026-10-15T12:00:00Z');
  const token=await newSession(env,now);
  const req=new Request('https://example.workers.dev/',{headers:{Cookie:sessionCookie(token)}});
  assert.equal(await validSession(req,env,now+1000),true);
  assert.equal(await validSession(req,env,now+24*3600_000+1),false);
  assert.equal(await validSession(new Request('https://example.workers.dev/',{headers:{Cookie:sessionCookie(token.slice(0,-2)+'zz')}}),env,now+1000),false);
});
test('CSRF guard enforces same origin',()=>{
  const ok=new Request('https://example.workers.dev/api/posts',{method:'POST',headers:{Origin:'https://example.workers.dev'}});
  const bad=new Request('https://example.workers.dev/api/posts',{method:'POST',headers:{Origin:'https://attacker.invalid'}});
  assert.equal(sameOrigin(ok),true);
  assert.equal(sameOrigin(bad),false);
});
