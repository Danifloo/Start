/** M2 Publisher — Cloudflare Workers Free + D1. No Meta credentials in source. */
export const SLOT_MINUTES = new Set([0, 15, 30, 45]);
const ZONE = 'America/New_York';
const GRAPH_VERSION = 'v25.0';
const GRAPH_HOST = `https://graph.instagram.com/${GRAPH_VERSION}`;
const SESSION_HOURS = 12;
const MAX_DELAY_MS = 45 * 60 * 1000;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const err = (message, status = 400) => json({ error: message }, status);
const now = () => Date.now();
const safeText = (s, max = 500) => String(s ?? '').slice(0, max);

export function nyTimeParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida');
  const items = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(items.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
}

export function safeHttpsUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname || u.port) return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ||
        host === '127.0.0.1' || host === '[::1]' || host === '0.0.0.0') return false;
    if (/^(10|127|0|169\.254|192\.168)\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

export function validatePost(raw, currentTime = now()) {
  if (!raw || typeof raw !== 'object') throw new Error('Datos de post incorrectos');
  const title = safeText(raw.title, 181).trim();
  const caption = safeText(raw.caption, 2201).trim();
  const source = safeText(raw.source, 2000).trim();
  const rights = safeText(raw.rights, 1000).trim();
  const images = raw.images;
  const t = typeof raw.scheduled_at === 'string' ? Date.parse(raw.scheduled_at) : NaN;
  if (title.length < 12 || title.length > 180) throw new Error('Titular: entre 12 y 180 caracteres');
  if (caption.length < 30 || caption.length > 2200) throw new Error('Descripción: entre 30 y 2200 caracteres');
  if (!safeHttpsUrl(source)) throw new Error('La fuente debe tener URL HTTPS pública');
  if (rights.length < 12) throw new Error('Indica licencia y créditos de las imágenes');
  if (!Array.isArray(images) || images.length < 2 || images.length > 10 ||
      images.some(x => typeof x !== 'string' || x.length > 2000 || !safeHttpsUrl(x))) {
    throw new Error('El carrusel necesita de 2 a 10 imágenes con URLs HTTPS públicas');
  }
  if (!Number.isFinite(t) || t <= currentTime + 60_000) throw new Error('El horario debe ser futuro');
  const parts = nyTimeParts(t);
  if (!SLOT_MINUTES.has(Number(parts.minute)) || Number(parts.second) !== 0) {
    throw new Error('En Nueva York, usa los minutos 00, 15, 30 o 45');
  }
  return { title, caption, source, rights, images, scheduled_at: t,
    topic_key: title.toLocaleLowerCase('es').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') };
}

const enc = new TextEncoder();
const toBase64Url = bytes => {
  let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const secureEq = (a, b) => {
  if (a.length !== b.length) return false;
  let n = 0; for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
};
async function sha(s) { return toBase64Url(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function sign(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
export async function issueSession(key, timestamp = now()) {
  const payload = `v1.${timestamp + SESSION_HOURS * 3600_000}`;
  return `${payload}.${await sign(key, payload)}`;
}
export async function verifySession(key, token, timestamp = now()) {
  if (!key || !token) return false;
  const match = /^v1\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match || Number(match[1]) < timestamp || Number(match[1]) > timestamp + SESSION_HOURS * 3600_000) return false;
  const payload = `v1.${match[1]}`;
  return secureEq(await sign(key, payload), match[2]);
}
const getCookie = (request, name) => (request.headers.get('cookie') || '').split(';')
  .map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
const cookie = (value, age = SESSION_HOURS * 3600) =>
  `m2_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const sameOrigin = request => {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
};
const loggedIn = async (request, env) => verifySession(env.SESSION_KEY, getCookie(request, 'm2_session'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const BASE_STYLES = `*{box-sizing:border-box}body{background:#0e1118;color:#f6f7fa;margin:0;font:15px system-ui,-apple-system,Segoe UI,sans-serif}a{color:#ffb447}input,textarea,button{font:inherit;border-radius:11px;padding:12px}input,textarea{background:#171d29;color:white;border:1px solid #495062;width:100%}button{border:0;background:#f5a33f;color:#1a130b;font-weight:800;cursor:pointer}button:disabled{opacity:.6}.wrap{max-width:1050px;padding:22px;margin:0 auto}.box{background:#191f2b;border:1px solid #323b4b;border-radius:17px;padding:20px;margin-top:16px}.muted{color:#aab3c4}.brand{color:#ffb447}nav{display:flex;justify-content:space-between;gap:15px;align-items:center;background:#171d28;padding:18px 24px;flex-wrap:wrap}h1{font-size:clamp(24px,5vw,36px)}h2{font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.stat{padding:16px;background:#242d3c;border-radius:12px}.stat b{font-size:25px;display:block}.form{display:grid;gap:10px}small{color:#aab3c4}.tag{display:inline-block;border-radius:8px;padding:4px 8px;background:#313b4b}.item{padding:12px 0;border-bottom:1px solid #303746;overflow-wrap:anywhere}.item:last-child{border:0}label{display:block;margin-bottom:4px;font-weight:600}header{margin:20px 0}`;
function loginPage() { return `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>M2 Publisher · Acceso</title><style>${BASE_STYLES}main{width:min(380px,90vw);margin:18vh auto}</style><main class="box"><h1>M2 <span class="brand">PUBLISHER</span></h1><p class="muted">Acceso privado · @maqued2</p><form class="form" action="/login" method="post"><label for="pass">Contraseña administrativa</label><input id="pass" type="password" name="password" minlength="16" autocomplete="current-password" required><button type="submit">Entrar</button></form></main></html>`; }
function dashboard() { return `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>M2 Publisher · Panel</title><style>${BASE_STYLES}</style><nav><strong>M2 <span class="brand">PUBLISHER</span></strong><span>@maqued2 · America/New_York</span><form action="/logout" method="post"><button>Salir</button></form></nav><main class="wrap"><header><h1>Centro de publicaciones</h1><p class="muted">Carruseles reales. Programación :00 · :15 · :30 · :45.</p></header><div class="grid"><div class="stat"><span>En cola</span><b id="queued">—</b></div><div class="stat"><span>Publicados con enlace</span><b id="published">—</b></div><div class="stat"><span>Revisión necesaria</span><b id="review">—</b></div></div><div class="box"><h2>Conexión con Instagram</h2><p id="connection">Comprobando…</p><p class="muted" id="quota"></p></div><div class="box"><h2>Nuevo carrusel</h2><p class="muted">Las imágenes deben estar alojadas públicamente por HTTPS y contar con licencia de uso. Esta versión programa publicaciones preparadas; no genera diseños automáticamente.</p><form id="add" class="form"><div><label for="title">Titular</label><input id="title" name="title" minlength="12" maxlength="180" required></div><div><label for="caption">Texto, créditos y hashtags</label><textarea id="caption" name="caption" rows="5" minlength="30" maxlength="2200" required></textarea></div><div><label for="source">Fuente verificada (HTTPS)</label><input id="source" name="source" type="url" required></div><div><label for="rights">Licencia y créditos</label><input id="rights" name="rights" minlength="12" required></div><div><label for="images">Enlaces a imágenes (uno por línea; 2–10)</label><textarea id="images" name="images" rows="4" required></textarea></div><div><label for="scheduled_at">Fecha y hora (zona de tu dispositivo)</label><input id="scheduled_at" type="datetime-local" name="scheduled_at" step="60" required><small>La aplicación comprobará los cuartos de hora según Nueva York.</small></div><button>Programar publicación</button><p id="notice" aria-live="polite"></p></form></div><div class="box"><h2>Cola y publicaciones</h2><div id="posts" class="muted">Cargando…</div></div><div class="box"><h2>Últimos eventos</h2><div id="events" class="muted">Cargando…</div></div></main><script>
const el=id=>document.getElementById(id);const fmt=t=>new Intl.DateTimeFormat('es-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(t);const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function refresh(){const r=await fetch('/api/state');if(!r.ok){location.href='/';return}const x=await r.json();el('queued').textContent=x.posts.filter(p=>p.status==='QUEUED').length;el('published').textContent=x.posts.filter(p=>p.status==='PUBLISHED').length;el('review').textContent=x.posts.filter(p=>['NEEDS_REVIEW','UNCERTAIN','VERIFYING','SENDING'].includes(p.status)).length;el('connection').textContent=x.connected?'Credenciales Meta configuradas; pendiente de probar autorización y publicar una vez.':'Pendiente: credenciales oficiales de Meta no configuradas.';el('quota').textContent=x.quota?'Última cuota conocida: '+x.quota.used+' / '+x.quota.total+' · '+fmt(x.quota.updated_at):'Cuota Meta todavía no verificada.';el('posts').innerHTML=x.posts.map(p=>'<div class="item"><b>'+escapeHtml(p.title)+'</b><p>'+fmt(p.scheduled_at)+' · <span class="tag">'+escapeHtml(p.status)+'</span></p>'+(p.permalink?'<a href="'+encodeURI(p.permalink)+'" target="_blank" rel="noopener">Ver post publicado</a>':'')+(p.last_error?'<p class="muted">'+escapeHtml(p.last_error)+'</p>':'')+'</div>').join('')||'<p>Sin publicaciones todavía.</p>';el('events').innerHTML=x.events.map(e=>'<div class="item"><small>'+fmt(e.created_at)+'</small> · <b>'+escapeHtml(e.code)+'</b> · '+escapeHtml(e.message)+'</div>').join('')||'<p>Sin eventos.</p>';}
el('add').addEventListener('submit',async ev=>{ev.preventDefault();const f=new FormData(ev.target);const body=Object.fromEntries(f);body.images=body.images.split(/\\n+/).map(s=>s.trim()).filter(Boolean);body.scheduled_at=new Date(body.scheduled_at).toISOString();const r=await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();el('notice').textContent=r.ok?'Carrusel añadido a la cola.':'No se pudo programar: '+(result.error||'Error desconocido');if(r.ok){ev.target.reset();refresh()}});refresh();setInterval(refresh,60000);
</script></html>`; }
const html = x => new Response(x, { headers: { 'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" } });

async function log(env, code, message, postId = null) {
  await env.DB.prepare('INSERT INTO events (post_id, code, message, created_at) VALUES (?, ?, ?, ?)')
    .bind(postId, safeText(code, 60), safeText(message, 400), now()).run();
}
async function meta(env, method, path, fields) {
  if (!env.IG_USER_ID || !env.IG_ACCESS_TOKEN) throw new Error('Faltan credenciales oficiales de Instagram');
  const p = path.replace(/^\/+/, '');
  const url = new URL(`${GRAPH_HOST}/${p}`);
  let body;
  if (method === 'GET') {
    for (const [k, v] of Object.entries(fields || {})) url.searchParams.set(k, String(v));
  } else body = new URLSearchParams(Object.entries(fields || {}).map(([k,v])=>[k,String(v)]));
  const res = await fetch(url.toString(), { method,
    headers: { Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`,
      ...(body ? {'Content-Type':'application/x-www-form-urlencoded'} : {}) }, body });
  let obj; try { obj = await res.json(); } catch { throw new Error(`Meta no devolvió JSON (HTTP ${res.status})`); }
  if (!res.ok || obj.error) throw new Error('Meta: ' + safeText(obj.error?.message || res.status, 300));
  return obj;
}
async function verifiedAccountAndQuota(env) {
  const profile = await meta(env,'GET','me',{fields:'id,username'});
  const expected = String(env.IG_EXPECTED_USERNAME || 'maqued2').replace(/^@/,'').toLowerCase();
  if (String(profile.id) !== String(env.IG_USER_ID) || String(profile.username).toLowerCase() !== expected)
    throw new Error('La cuenta Meta no coincide con @'+expected);
  const res = await meta(env,'GET',`${env.IG_USER_ID}/content_publishing_limit`,{fields:'quota_usage,config'});
  const quota = (res.data || [res])[0]; const used=Number(quota?.quota_usage),total=Number(quota?.config?.quota_total);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total < 1) throw new Error('Meta no confirmó la cuota; no se enviará');
  await env.DB.prepare("INSERT INTO settings (key,value,updated_at) VALUES ('quota',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .bind(JSON.stringify({used,total,updated_at:now()}),now()).run();
  return {used,total};
}
async function updatePost(env,id,status,options={}) {
  await env.DB.prepare('UPDATE posts SET status=?, last_error=?, meta_container_id=COALESCE(?, meta_container_id), meta_media_id=COALESCE(?, meta_media_id), permalink=COALESCE(?, permalink), updated_at=? WHERE id=?')
    .bind(status,options.error??null,options.container??null,options.mediaId??null,options.permalink??null,now(),id).run();
}
async function verifyExisting(env) {
  const items=(await env.DB.prepare("SELECT id,meta_media_id FROM posts WHERE status='VERIFYING' AND meta_media_id IS NOT NULL ORDER BY scheduled_at LIMIT 3").all()).results||[];
  for (const p of items) {
    try {
      const res=await meta(env,'GET',p.meta_media_id,{fields:'id,permalink'});
      const link=res.permalink;
      if (typeof link==='string' && /^https:\/\/(www\.)?instagram\.com\/(p|reel)\//.test(link)) {
        await updatePost(env,p.id,'PUBLISHED',{mediaId:p.meta_media_id,permalink:link});
        await log(env,'PUBLISHED','Enlace público confirmado',p.id);
      }
    } catch(ex) { await log(env,'VERIFY_PENDING',ex.message,p.id); }
  }
}

async function publish(env,item) {
  const urls=JSON.parse(item.images_json); const children=[];
  for (const url of urls) {
    const child=await meta(env,'POST',`${env.IG_USER_ID}/media`,{image_url:url,is_carousel_item:'true'});
    if (!child.id) throw new Error('Meta no creó la imagen del carrusel');
    children.push(child.id);
  }
  const outer=await meta(env,'POST',`${env.IG_USER_ID}/media`,{
    media_type:'CAROUSEL',children:children.join(','),caption:item.caption});
  if (!outer.id) throw new Error('Meta no creó el contenedor');
  await updatePost(env,item.id,'PREPARING',{container:outer.id});
  let ready=false;
  for(let i=0;i<20;i++) {
    const r=await meta(env,'GET',outer.id,{fields:'status_code'});
    if(r.status_code==='FINISHED'){ready=true;break;}
    if(['ERROR','EXPIRED'].includes(r.status_code)) throw new Error('Meta rechazó el carrusel: '+r.status_code);
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  if(!ready) throw new Error('Contenedor sin terminar; no publicar de nuevo automáticamente');
  // Intentional safety barrier: persist state BEFORE non-idempotent media_publish.
  await updatePost(env,item.id,'PUBLISHING',{container:outer.id});
  const published=await meta(env,'POST',`${env.IG_USER_ID}/media_publish`,{creation_id:outer.id});
  if(!published.id) throw new Error('Meta no entregó ID de publicación (resultado incierto)');
  await updatePost(env,item.id,'VERIFYING',{container:outer.id,mediaId:published.id});
  const link=await meta(env,'GET',published.id,{fields:'id,permalink'});
  if(!/^https:\/\/(www\.)?instagram\.com\/(p|reel)\//.test(link.permalink||'')) {
    await log(env,'VERIFY_PENDING','Meta aún no entregó enlace público',item.id);
    return;
  }
  await updatePost(env,item.id,'PUBLISHED',{mediaId:published.id,permalink:link.permalink});
  await log(env,'PUBLISHED','Publicación verificada en Instagram',item.id);
}

export async function runScheduler(env, timestamp=now()) {
  if(!env.DB) throw new Error('D1 no configurada');
  if(!env.IG_USER_ID || !env.IG_ACCESS_TOKEN) return {result:'NOT_CONNECTED'};
  await verifyExisting(env);
  await env.DB.prepare("UPDATE posts SET status='MISSED',last_error='Horarios vencidos hace más de 45 minutos',updated_at=? WHERE status='QUEUED' AND scheduled_at<?")
    .bind(timestamp,timestamp-MAX_DELAY_MS).run();
  const existing=await env.DB.prepare("SELECT id,scheduled_at FROM posts WHERE status='QUEUED' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1")
    .bind(timestamp).first();
  if(!existing) return {result:'EMPTY'};
  // Too late: skip, do not surprise followers with a burst of stale news.
  if(timestamp-existing.scheduled_at>MAX_DELAY_MS){
    await env.DB.prepare("UPDATE posts SET status='MISSED', last_error='Horario vencido por más de 45 minutos', updated_at=? WHERE id=? AND status='QUEUED'")
      .bind(timestamp,existing.id).run();
    await log(env,'MISSED','Publicación no enviada por retraso',existing.id);
    return {result:'MISSED'};
  }
  let quota;
  try { quota=await verifiedAccountAndQuota(env); }
  catch(e){await log(env,'META_PREFLIGHT',e.message);return {result:'META_ERROR'};}
  if(quota.used >= quota.total){
    await log(env,'QUOTA_FULL',`Cuota de Meta agotada (${quota.used}/${quota.total}); cola conservada`);
    return {result:'QUOTA_FULL'};
  }
  // Global 10-minute DB lease prevents concurrent scheduler events from sending two posts.
  const lease=await env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('cron_lease',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE settings.updated_at<? RETURNING value")
    .bind(String(timestamp),timestamp,timestamp-10*60_000).first();
  if (!lease) return {result:'LOCKED'};
  // SQLite atomic claim prevents concurrent scheduler invocations sending the same post.
  const claim=await env.DB.prepare("UPDATE posts SET status='SENDING', updated_at=? WHERE id=(SELECT id FROM posts WHERE status='QUEUED' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1) AND status='QUEUED' RETURNING *")
    .bind(timestamp,timestamp).first();
  if(!claim) return {result:'CLAIMED_ELSEWHERE'};
  try { await publish(env,claim); return {result:'SENT_OR_VERIFYING',id:claim.id}; }
  catch(e) {
    // Treat *any* failure after claiming as uncertain. Re-send only after manual investigation.
    await updatePost(env,claim.id,'UNCERTAIN',{error:safeText(e.message,350)});
    await log(env,'UNCERTAIN',safeText(e.message,350),claim.id);
    return {result:'UNCERTAIN',id:claim.id};
  }
}

async function fetchHandler(request,env){
  const u=new URL(request.url); const path=u.pathname;
  if(path==='/health' && request.method==='GET') return json({ok:true,worker:'m2-publisher-free',instagramConfigured:Boolean(env.IG_USER_ID&&env.IG_ACCESS_TOKEN)});
  if(!env.DB) return err('Base de datos D1 no configurada',503);
  if(!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length<16 || !env.SESSION_KEY || env.SESSION_KEY.length<32)
    return err('Configura los secretos ADMIN_PASSWORD y SESSION_KEY para activar el panel',503);
  if(path==='/login' && request.method==='POST') {
    if(!sameOrigin(request)) return err('Origen inválido',403);
    const ip=safeText(request.headers.get('cf-connecting-ip')||'unknown',80);
    const key=await sha(ip); const bound=now()-15*60_000;
    const attempts=(await env.DB.prepare('SELECT failures, updated_at FROM login_attempts WHERE ip_hash=?').bind(key).first());
    if(attempts && attempts.failures>=5 && attempts.updated_at>bound) return err('Espera quince minutos para volver a intentar',429);
    const form=await request.formData();const pass=String(form.get('password')||'');
    if(!secureEq(await sha(pass),await sha(env.ADMIN_PASSWORD))){
      await env.DB.prepare('INSERT INTO login_attempts(ip_hash, failures, updated_at) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET failures=CASE WHEN updated_at<? THEN 1 ELSE failures+1 END,updated_at=excluded.updated_at')
        .bind(key,now(),bound).run();
      return err('Contraseña incorrecta',401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash=?').bind(key).run();
    const token=await issueSession(env.SESSION_KEY);
    return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':cookie(token), 'Cache-Control':'no-store'}});
  }
  if(path==='/'&&request.method==='GET') return html((await loggedIn(request,env))?dashboard():loginPage());
  if(!await loggedIn(request,env)) return err('Acceso privado',401);
  if(path==='/logout'&&request.method==='POST'){
    if(!sameOrigin(request)) return err('Origen inválido',403);
    return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':cookie('',0)}});
  }
  if(path==='/api/state'&&request.method==='GET') {
    const [posts,events,q]=await Promise.all([
      env.DB.prepare('SELECT id,title,scheduled_at,status,permalink,last_error FROM posts ORDER BY scheduled_at DESC LIMIT 150').all(),
      env.DB.prepare('SELECT code,message,created_at FROM events ORDER BY id DESC LIMIT 30').all(),
      env.DB.prepare("SELECT value FROM settings WHERE key='quota'").first()]);
    return json({posts:posts.results||[],events:events.results||[],connected:Boolean(env.IG_USER_ID&&env.IG_ACCESS_TOKEN),quota:q?JSON.parse(q.value):null});
  }
  if(path==='/api/posts'&&request.method==='POST'){
    if(!sameOrigin(request))return err('Origen inválido',403);
    let payload;try{payload=await request.json();}catch{return err('JSON inválido');}
    let data;try{data=validatePost(payload);}catch(e){return err(e.message,422);}
    const id=crypto.randomUUID();const stamp=now();
    try {await env.DB.prepare('INSERT INTO posts(id,topic_key,title,caption,source_url,rights,images_json,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,? ,\'QUEUED\',?,?)')
      .bind(id,data.topic_key,data.title,data.caption,data.source,data.rights,JSON.stringify(data.images),data.scheduled_at,stamp,stamp).run();}
    catch(e){if(/UNIQUE|constraint/i.test(e.message))return err('Tema u horario duplicado',409);return err('No se pudo guardar',500);}
    await log(env,'QUEUED','Carrusel programado para '+new Date(data.scheduled_at).toISOString(),id);
    return json({ok:true,id,status:'QUEUED',scheduled_at:data.scheduled_at},201);
  }
  return err('Ruta no encontrada',404);
}

export default {
  async fetch(request,env) {try{return await fetchHandler(request,env);}catch(e){console.error('M2 request error',safeText(e.message,150));return err('Error de servidor',500);}},
  async scheduled(controller,env,ctx) {ctx.waitUntil(runScheduler(env,controller.scheduledTime).catch(e=>console.error('M2 cron error',safeText(e.message,150))));},
};
