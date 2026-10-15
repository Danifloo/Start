const enc = new TextEncoder();
const MAX_AGE = 24 * 60 * 60 * 1000;

function bytesToBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64UrlToBytes(value) {
  const s = value.replace(/-/g,'+').replace(/_/g,'/');
  const decoded = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(decoded, c=>c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
async function digest(str) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(str)));
}
function constantTimeEquals(a, b) {
  let diff = a.length ^ b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++) diff |= (a[i]||0) ^ (b[i]||0);
  return diff === 0;
}
export async function passwordMatches(given, env) {
  return constantTimeEquals(await digest(String(given)), await digest(env.ADMIN_PASSWORD || ''));
}
export async function newSession(env, now=Date.now()) {
  const n=crypto.getRandomValues(new Uint8Array(16));
  const payload=`${now+MAX_AGE}.${bytesToBase64Url(n)}`;
  const key=await hmacKey(env.SESSION_SECRET);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));
  return `${bytesToBase64Url(enc.encode(payload))}.${bytesToBase64Url(sig)}`;
}
export async function validSession(request,env,now=Date.now()) {
  if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32) return false;
  const cookie=request.headers.get('Cookie')||'';
  const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('m2_session='))?.slice(11);
  if(!token || token.length>300) return false;
  try {
    const parts=token.split('.');
    if(parts.length!==2) return false;
    const payloadBytes=base64UrlToBytes(parts[0]);
    const sigBytes=base64UrlToBytes(parts[1]);
    const payload=new TextDecoder().decode(payloadBytes);
    const [exp,nonce]=payload.split('.');
    if(!/^\d{13}$/.test(exp)||!nonce||Number(exp)<now||Number(exp)>now+MAX_AGE) return false;
    const key=await hmacKey(env.SESSION_SECRET);
    return await crypto.subtle.verify('HMAC',key,sigBytes,payloadBytes);
  } catch{return false;}
}
export function sessionCookie(value,secure=true) {
  return `m2_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure?'; Secure':''}`;
}
export function clearCookie(secure=true) {
  return `m2_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`;
}
export function sameOrigin(req) {
  const origin=req.headers.get('Origin');
  if(!origin) return false;
  try {return new URL(origin).origin===new URL(req.url).origin;} catch{return false;}
}
export async function loginFingerprint(request,env) {
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const key=await digest(`${env.SESSION_SECRET}:${ip}`);
  return [...key].map(x=>x.toString(16).padStart(2,'0')).join('');
}
