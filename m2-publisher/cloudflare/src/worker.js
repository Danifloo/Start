import {loginHtml,dashboardHtml,browserJs} from './ui.js';
import {validatePost,parseScheduled,MAX_LATE_MS} from './logic.js';
import {validSession,newSession,passwordMatches,sessionCookie,clearCookie,sameOrigin,loginFingerprint} from './auth.js';
import {verifyAccountAndQuota,publishCarousel,getPermalink,instagramConfigured} from './instagram.js';

const SECURITY_HEADERS={
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(),microphone=(),geolocation=()',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{...SECURITY_HEADERS,'Content-Type':'application/json; charset=utf-8',...headers}});
const html=(body,status=200)=>new Response(body,{status,headers:{...SECURITY_HEADERS,'Content-Type':'text/html; charset=utf-8'}});
const reason=(e)=>String(e?.message||e||'Error no identificado').slice(0,300);
const nowMs=()=>Date.now();

function startupConfigured(env){return typeof env.ADMIN_PASSWORD==='string'&&env.ADMIN_PASSWORD.length>=16&&typeof env.SESSION_SECRET==='string'&&env.SESSION_SECRET.length>=32;}
function publishingEnabled(env){return env.ENABLE_PUBLISHING==='true'&&instagramConfigured(env);}
function isConflict(e){return /UNIQUE constraint failed/i.test(String(e?.message||e));}
async function log(env,action,postId=null,detail=''){
  try{await env.DB.prepare('INSERT INTO app_events(timestamp_ms,action,post_id,detail) VALUES(?,?,?,?)').bind(nowMs(),action,postId,String(detail).slice(0,350)).run();}
  catch(e){console.error('Error al guardar evento',reason(e));}
}
async function parseJson(request){
  if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))throw new Error('Se requiere JSON.');
  const str=await request.text();
  if(str.length>30_000)throw new Error('Solicitud demasiado grande.');
  try {return JSON.parse(str);}catch{throw new Error('JSON no válido.');}
}
async function addPost(request,env){
  const data=validatePost(await parseJson(request));
  const source=new URL(data.source_url);
  source.searchParams.delete('utm_source');source.searchParams.delete('utm_medium');source.searchParams.delete('utm_campaign');
  const normalizedSource=source.toString();
  const fingerprint=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizedSource)));
  const story_key=Array.from(fingerprint).map(x=>x.toString(16).padStart(2,'0')).join('');
  const id=crypto.randomUUID();const t=nowMs();
  try{await env.DB.prepare(`INSERT INTO posts(id,title,story_key,caption,source_url,image_rights,images_json,scheduled_ms,status,created_ms,updated_ms)
    VALUES(?,?,?,?,?,?,?,?, 'SCHEDULED', ?,?)`).bind(id,data.title,story_key,data.caption,normalizedSource,data.image_rights,JSON.stringify(data.images),data.scheduled_ms,t,t).run();}
  catch(e){if(isConflict(e))return json({error:'Ya existe una noticia con ese titular, esa fuente o ese horario.'},409);throw e;}
  await log(env,'POST_SCHEDULED',id,`${data.title} · ${new Date(data.scheduled_ms).toISOString()}`);
  return json({ok:true,id,scheduled_at:new Date(data.scheduled_ms).toISOString(),status:'SCHEDULED'},201);
}
async function events(env){
  const result=await env.DB.prepare('SELECT timestamp_ms,action,post_id,detail FROM app_events ORDER BY timestamp_ms DESC,id DESC LIMIT 40').all();
  return json(result.results||[]);
}
async function posts(env){
  const result=await env.DB.prepare('SELECT id,title,scheduled_ms,status,permalink,last_error,media_id FROM posts ORDER BY scheduled_ms DESC LIMIT 250').all();
  return json(result.results||[]);
}
async function status(env){
  const r=await env.DB.prepare('SELECT key,value FROM app_meta').all();
  const meta=Object.fromEntries((r.results||[]).map(x=>[x.key,x.value]));
  return json({publishing_enabled:publishingEnabled(env),instagram_configured:instagramConfigured(env),r2_configured:Boolean(env.MEDIA),expected_username:env.IG_EXPECTED_USERNAME||'maqued2',last_cron_at:meta.last_cron_at||null});
}
async function cancelPost(env,id){
  const t=nowMs();
  const r=await env.DB.prepare("UPDATE posts SET status='CANCELLED',updated_ms=? WHERE id=? AND status='SCHEDULED'").bind(t,id).run();
  if(!(r.meta?.changes>0))return json({error:'Solo pueden cancelarse publicaciones que sigan programadas.'},409);
  await log(env,'POST_CANCELLED',id);
  return json({ok:true});
}
async function reschedulePost(request,env,id) {
  const data=await parseJson(request);
  let newStamp;
  try { newStamp=validateScheduleOnly(data.scheduled_at); }
  catch(e) { return json({error:reason(e)},422); }
  const now=nowMs();
  try {
    const result=await env.DB.prepare(`UPDATE posts SET scheduled_ms=?,status='SCHEDULED',last_error=NULL,
      updated_ms=? WHERE id=? AND status IN ('BLOCKED','MISSED') AND container_id IS NULL AND media_id IS NULL`)
      .bind(newStamp,now,id).run();
    if(!(result.meta?.changes>0))return json({error:'Solo es seguro reprogramar envíos bloqueados antes de crear el contenedor de Instagram.'},409);
  }catch(e){if(isConflict(e))return json({error:'El horario ya pertenece a otro post.'},409);throw e;}
  await log(env,'POST_RESCHEDULED',id,new Date(newStamp).toISOString());
  return json({ok:true,scheduled_at:new Date(newStamp).toISOString()});
}
function validateScheduleOnly(stamp){
  // Use the same time-zone and quarter-hour constraints as normal creation.
  return parseScheduled(stamp,nowMs());
}
async function saveState(env,id,newStatus,fields={}){
  const allowed=['container_id','media_id','permalink','last_error'];
  const entries=Object.entries(fields).filter(([k])=>allowed.includes(k));
  const sets=['status=?','updated_ms=?',...entries.map(([k])=>`${k}=?`)];
  await env.DB.prepare(`UPDATE posts SET ${sets.join(',')} WHERE id=?`).bind(newStatus,nowMs(),...entries.map(([,v])=>v),id).run();
}
async function verifySaved(env,post){
  if(!post.media_id)return false;
  const permalink=await getPermalink(env,post.media_id);
  if(!permalink)return false;
  await saveState(env,post.id,'PUBLISHED',{permalink,last_error:null});
  await log(env,'POST_PUBLISHED',post.id,permalink);
  return true;
}
async function reconfirm(env,id){
  const post=await env.DB.prepare("SELECT * FROM posts WHERE id=? AND status IN ('VERIFYING','REVIEW')").bind(id).first();
  if(!post)return json({error:'No hay publicación pendiente de verificación.'},404);
  if(!post.media_id)return json({error:'Meta no entregó media_id. Se necesita revisar la cuenta en Instagram; no se repetirá el envío.'},409);
  try{if(await verifySaved(env,post))return json({ok:true,status:'PUBLISHED'});
    return json({ok:false,status:'VERIFYING',error:'Instagram todavía no devolvió un enlace público.'},202);
  }catch(e){return json({error:reason(e)},502);}
}
async function takeDuePost(env,now){
  const cutoff=now-MAX_LATE_MS;
  const expired=await env.DB.prepare("UPDATE posts SET status='MISSED',last_error='Horario vencido: no se publican noticias antiguas automáticamente.',updated_ms=? WHERE status='SCHEDULED' AND scheduled_ms<?").bind(now,cutoff).run();
  if(expired.meta?.changes)await log(env,'MISSED_SLOTS',null,String(expired.meta.changes));
  // Atomic D1 SQLite claim. Only one cron invocation can claim the same post.
  const r=await env.DB.prepare(`UPDATE posts SET status='SENDING',updated_ms=? WHERE id=(
      SELECT id FROM posts WHERE status='SCHEDULED' AND scheduled_ms<=? ORDER BY scheduled_ms ASC LIMIT 1
    ) AND status='SCHEDULED' RETURNING *`).bind(now,now).first();
  return r||null;
}

export async function scheduledCycle(env,time=Date.now()){
  if(!env.DB)throw new Error('Falta la base de datos D1.');
  await env.DB.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('last_cron_at',new Date(time).toISOString()).run();
  if(!publishingEnabled(env))return {action:'PUBLISHING_DISABLED'};
  // Resolve already-sent posts first; never send a second copy to recover an ambiguous result.
  const unverified=await env.DB.prepare("SELECT * FROM posts WHERE status='VERIFYING' AND media_id IS NOT NULL ORDER BY updated_ms LIMIT 1").first();
  if(unverified){try{await verifySaved(env,unverified);}catch(e){await log(env,'VERIFY_FAILED',unverified.id,reason(e));}}
  const post=await takeDuePost(env,time);
  if(!post)return {action:'NO_DUE_POST'};
  let irreversible=false;
  try{
    const record=async (state,fields={})=>{
      if(state==='VERIFYING')irreversible=true;
      await saveState(env,post.id,state,fields);
    };
    const mediaId=await publishCarousel(env,post,record);
    const permalink=await getPermalink(env,mediaId);
    if(permalink){await saveState(env,post.id,'PUBLISHED',{media_id:mediaId,permalink,last_error:null});await log(env,'POST_PUBLISHED',post.id,permalink);}
    else {await saveState(env,post.id,'VERIFYING',{media_id:mediaId,last_error:'Meta entregó ID, falta enlace verificable.'});await log(env,'POST_VERIFYING',post.id);}
    return {action:'SENT',id:post.id};
  }catch(e){
    const message=reason(e);
    const state=irreversible?'REVIEW':'BLOCKED';
    await saveState(env,post.id,state,{last_error:message});
    await log(env,'POST_'+state,post.id,message);
    return {action:state,id:post.id,error:message};
  }
}

async function uploadAsset(req,env){
  if(!env.MEDIA)return json({error:'El almacenamiento R2 no está configurado. Usa URLs HTTPS públicas de imágenes autorizadas.'},503);
  const mime=(req.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(!['image/jpeg','image/png'].includes(mime))return json({error:'Solo fotografías JPG o PNG.'},415);
  const size=Number(req.headers.get('Content-Length')||0);
  if(size>5_000_000)return json({error:'Máximo 5 MB por fotografía.'},413);
  const blob=await req.arrayBuffer();
  if(blob.byteLength<100||blob.byteLength>5_000_000)return json({error:'Archivo vacío o superior a 5 MB.'},413);
  const header=new Uint8Array(blob.slice(0,8));
  const jpg=header[0]===255&&header[1]===216&&header[2]===255;
  const png=[137,80,78,71,13,10,26,10].every((n,i)=>header[i]===n);
  if(!(mime==='image/jpeg'&&jpg||mime==='image/png'&&png))return json({error:'El contenido no coincide con un JPG o PNG real.'},422);
  const key=crypto.randomUUID()+ (jpg?'.jpg':'.png');
  await env.MEDIA.put(key,blob,{httpMetadata:{contentType:mime},customMetadata:{origin:'m2-publisher'}});
  await log(env,'ASSET_UPLOADED',null,key);
  return json({ok:true,url:new URL('/media/'+key,req.url).toString()},201);
}
async function getAsset(req,env,path){
  if(!env.MEDIA)return json({error:'Imágenes no configuradas.'},404);
  const key=path.slice('/media/'.length);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/.test(key))return json({error:'Imagen inválida.'},404);
  const obj=req.method==='HEAD'?await env.MEDIA.head(key):await env.MEDIA.get(key);
  if(!obj)return json({error:'Imagen inexistente.'},404);
  const headers={'Content-Type':obj.httpMetadata?.contentType||'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};
  return new Response(req.method==='HEAD'?null:obj.body,{status:200,headers});
}
async function login(req,env){
  if(!startupConfigured(env))return json({error:'Configura los secretos del panel primero.'},503);
  const fingerprint=await loginFingerprint(req,env);
  const now=nowMs();const WINDOW=15*60*1000;
  const state=await env.DB.prepare('SELECT failures,window_started_ms FROM login_limits WHERE fingerprint=?').bind(fingerprint).first();
  if(state&&state.window_started_ms>now-WINDOW&&state.failures>=5)return json({error:'Demasiados intentos. Espera 15 minutos.'},429);
  const data=await parseJson(req);
  if(typeof data.password!=='string'||data.password.length>1024||!(await passwordMatches(data.password,env))){
    await env.DB.prepare(`INSERT INTO login_limits(fingerprint,failures,window_started_ms) VALUES(?,1,?) ON CONFLICT(fingerprint)
    DO UPDATE SET failures=CASE WHEN window_started_ms<? THEN 1 ELSE failures+1 END,
    window_started_ms=CASE WHEN window_started_ms<? THEN excluded.window_started_ms ELSE window_started_ms END`)
      .bind(fingerprint,now,now-WINDOW,now-WINDOW).run();
    return json({error:'Contraseña incorrecta.'},401);
  }
  await env.DB.prepare('DELETE FROM login_limits WHERE fingerprint=?').bind(fingerprint).run();
  const session=await newSession(env);
  return json({ok:true},200,{'Set-Cookie':sessionCookie(session,new URL(req.url).protocol==='https:')});
}

export async function route(req,env){
  const u=new URL(req.url);const path=u.pathname;
  if(req.method==='GET'&&path==='/health')return json({status:'ok'});
  if((req.method==='GET'||req.method==='HEAD')&&path.startsWith('/media/'))return getAsset(req,env,path);
  if(req.method==='GET'&&path==='/app.js')return new Response(browserJs,{headers:{...SECURITY_HEADERS,'Content-Type':'application/javascript; charset=utf-8'}});
  if(!env.DB)return json({error:'La base de datos Cloudflare D1 no está conectada.'},503);
  if(path==='/'&&req.method==='GET')return html((await validSession(req,env))?dashboardHtml:loginHtml);
  if(!startupConfigured(env))return json({error:'Configura ADMIN_PASSWORD y SESSION_SECRET con valores seguros antes de usar el panel.'},503);
  if(req.method!=='GET'&&req.method!=='HEAD'&&!sameOrigin(req))return json({error:'Origen no autorizado.'},403);
  if(path==='/api/login'&&req.method==='POST')return login(req,env);
  if(!(await validSession(req,env)))return json({error:'Acceso privado: inicia sesión.'},401);
  if(path==='/api/logout'&&req.method==='POST')return json({ok:true},200,{'Set-Cookie':clearCookie(u.protocol==='https:')});
  if(path==='/api/status'&&req.method==='GET')return status(env);
  if(path==='/api/events'&&req.method==='GET')return events(env);
  if(path==='/api/posts'&&req.method==='GET')return posts(env);
  if(path==='/api/posts'&&req.method==='POST')return addPost(req,env);
  if(path==='/api/quota'&&req.method==='GET'){
    try{return json(await verifyAccountAndQuota(env));}catch(e){return json({error:reason(e)},502);}
  }
  if(path==='/api/assets'&&req.method==='POST')return uploadAsset(req,env);
  const idAction=path.match(/^\/api\/posts\/([a-f\d-]{36})\/(cancel|recheck|reschedule)$/);
  if(idAction&&req.method==='POST'){
    if(idAction[2]==='cancel')return cancelPost(env,idAction[1]);
    if(idAction[2]==='recheck')return reconfirm(env,idAction[1]);
    return reschedulePost(req,env,idAction[1]);
  }
  return json({error:'Ruta inexistente.'},404);
}

export default {
  async fetch(request,env) {
    try {return await route(request,env);}
    catch(e) {
      console.error('Request error',reason(e));
      return json({error:reason(e)},(e instanceof SyntaxError||e?.message?.startsWith('Se requiere')||e?.message?.startsWith('Solicitud demasiado'))?400:500);
    }
  },
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(scheduledCycle(env,nowMs()));
  }
};
