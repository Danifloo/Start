const CSS=`
:root{font-family:Inter,ui-sans-serif,system-ui,Arial,sans-serif;color-scheme:dark}
*{box-sizing:border-box}body{background:#0b0e14;color:#f2f5fb;margin:0;min-height:100vh;font-size:14px}
a{color:#efb64b}button,input,textarea{font:inherit}button{background:#f4ad37;border:0;border-radius:10px;padding:12px 16px;cursor:pointer;color:#1b1a14;font-weight:750}
button:disabled{opacity:.5;cursor:not-allowed}.outline{background:transparent;border:1px solid #465065;color:#f5f6f8}
header{background:#151a24;border-bottom:1px solid #273142;padding:16px clamp(16px,3vw,40px);display:flex;justify-content:space-between;align-items:center;gap:12px}
header strong{font-weight:900;font-size:20px;letter-spacing:-.5px}.brand{color:#f2ae38}
main{width:min(1140px,100%);margin:auto;padding:22px clamp(14px,3vw,32px) 70px}
h1{font-size:clamp(27px,4vw,37px);margin:8px 0 10px}h2{font-size:17px;margin-top:0}.muted{color:#b3becc}.small{font-size:12px}
.layout{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:#151b26;border:1px solid #2a3241;border-radius:18px;padding:22px;margin:12px 0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{background:#202737;border:1px solid #303b4b;border-radius:14px;padding:16px}.stat b{display:block;font-size:27px;margin-top:9px}
label{display:block;color:#cbd1dc;margin:12px 0 4px;font-weight:650}input,textarea{width:100%;border-radius:10px;border:1px solid #3a4558;background:#111722;color:#f5f6fa;padding:12px;margin:4px 0 6px}textarea{min-height:85px;resize:vertical}
.pill{display:inline-block;padding:5px 9px;background:#263143;border-radius:99px;color:#cbd5e1;font-size:12px}.pill.ok{color:#9be5aa;background:#173825}.pill.bad{color:#ffc29d;background:#4b2b27}
.gridList{list-style:none;padding:0;margin:0}.gridList li{padding:15px 0;border-bottom:1px solid #303747}.gridList li:last-child{border:0}.status{font-weight:700;font-size:12px;color:#f6b851}
.flex{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.full{width:100%}
.banner{border-left:4px solid #f4ad37;padding:12px 16px;background:#29251a;border-radius:8px;margin:14px 0}
.error{color:#ffc3b8}.success{color:#9debc4}.uploadrow{display:flex;gap:10px;align-items:center}.uploadrow input{min-width:0}
@media(max-width:800px){.layout{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}header{align-items:flex-start;flex-wrap:wrap}.card{padding:16px}}
`;
const head=(title)=>`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0b0e14"><title>${title}</title><style>${CSS}</style></head><body>`;

export const loginHtml = head('M2 Publisher — Acceso')+`
<main style="max-width:440px;padding-top:12vh"><div class="card"><h1>M2 <span class="brand">PUBLISHER</span></h1><p class="muted">Panel privado de @maqued2</p>
<form id="login"><label for="pass">Contraseña de administrador</label><input id="pass" type="password" minlength="16" autocomplete="current-password" required><button class="full">Entrar</button></form><p id="notice" role="status" class="error"></p>
</div><p class="muted small">Nunca introduzcas aquí tu contraseña de Instagram. Solo usa la contraseña privada del panel.</p></main><script src="/app.js"></script></body></html>`;

export const dashboardHtml = head('M2 Publisher — Control')+`
<header><strong>M2 <span class="brand">PUBLISHER</span></strong><span class="muted">@maqued2 · America/New_York</span><button class="outline" id="logout">Salir</button></header>
<main><div class="flex"><div><h1>Centro de publicaciones</h1><p class="muted">Noticia verificada → carrusel → programación → Instagram</p></div><span id="mode" class="pill bad">Comprobando conexión…</span></div>
<div id="warning" class="banner">En la instalación inicial la publicación real está desactivada.</div>
<div class="stats" id="stats"><div class="stat">Programados<b>—</b></div><div class="stat">Publicados<b>—</b></div><div class="stat">Revisión<b>—</b></div><div class="stat">Sin publicar<b>—</b></div></div>
<div class="layout"><section>
<div class="card"><h2>Programar carrusel</h2><p class="muted small">Usa de 2 a 10 imágenes reales con derechos comprobados. No generamos noticias automáticamente todavía.</p>
<form id="createPost"><label>Titular único</label><input required name="title" minlength="12" maxlength="180" placeholder="Ej. Un nuevo avance de la NASA"/>
<label>Descripción y hashtags</label><textarea required minlength="30" maxlength="2200" name="caption" placeholder="Hechos, contexto, fuentes, créditos y hashtags"></textarea>
<label>Fuente verificable HTTPS</label><input name="source_url" type="url" required placeholder="https://..."/>
<label>Licencias y créditos</label><input name="image_rights" required minlength="12" placeholder="Autor · Licencia · URL"/>
<label>Imágenes HTTPS, una URL por línea</label><textarea name="images" required placeholder="https://servidor-publico/foto1.jpg\nhttps://servidor-publico/foto2.jpg"></textarea>
<div id="assets" hidden><label>O subir imágenes autorizadas desde el teléfono</label><div class="uploadrow"><input id="file" type="file" accept="image/png,image/jpeg"/><button class="outline" type="button" id="upload">Subir</button></div><p id="uploadResult" class="muted small"></p></div>
<label>Fecha/hora local del teléfono</label><input name="scheduled_at" type="datetime-local" required step="900"/><p class="muted small">Los horarios se validan para :00, :15, :30 y :45, hora de Nueva York. Si tu teléfono tiene otra zona, comprueba la hora antes de guardar.</p>
<button class="full" type="submit">Guardar en la cola</button><p id="submitResult" role="status"></p></form></div>
<div class="card"><h2>Cuota oficial Instagram</h2><p id="quota" class="muted">Necesita conexión oficial</p><button type="button" class="outline" id="checkQuota">Comprobar cuota</button></div>
</section><section>
<div class="card"><div class="flex"><h2>Próximos intervalos</h2><span class="pill">15 minutos</span></div><ul id="slots" class="gridList"></ul></div>
<div class="card"><div class="flex"><h2>Cola y resultados</h2><button type="button" class="outline" id="refresh">Actualizar</button></div><ul id="posts" class="gridList"><li class="muted">Cargando…</li></ul></div>
<div class="card"><h2>Registro de actividad</h2><ul id="events" class="gridList"><li class="muted">Sin actividad</li></ul></div>
</section></div><p class="muted small">M2 Publisher · publicación automática solo si se habilita expresamente y Meta confirma identidad y cuota · No se publica contenido de relleno.</p></main><script src="/app.js"></script></body></html>`;

export const browserJs = `
const $=id=>document.getElementById(id);
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let out;try{out=await r.json();}catch{out={error:'Respuesta inválida del servidor'};}if(!r.ok)throw new Error(out.error||'Solicitud rechazada');return out;}
function el(tag,text,cls){const x=document.createElement(tag);if(text!=null)x.textContent=text;if(cls)x.className=cls;return x;}
function statusText(s){return ({SCHEDULED:'PROGRAMADO',PUBLISHED:'PUBLICADO',VERIFYING:'VERIFICANDO',REVIEW:'REVISAR',BLOCKED:'BLOQUEADO',MISSED:'HORARIO PERDIDO',CANCELLED:'CANCELADO',SENDING:'ENVIANDO'})[s]||s;}
function dateNY(ms){return new Intl.DateTimeFormat('es-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(ms));}
function showSlots(){if(!$('slots'))return;let next=Math.ceil((Date.now()+60000)/900000)*900000;const node=$('slots');node.replaceChildren();for(let i=0;i<8;i++){const li=el('li',dateNY(next+i*900000));node.append(li);}}
async function refresh(){try{const [data,status,log]=await Promise.all([api('/api/posts'),api('/api/status'),api('/api/events')]);
const counts=['SCHEDULED','PUBLISHED','VERIFYING','MISSED'].map(k=>data.filter(x=>x.status===k).length);
$('stats').replaceChildren(...['Programados','Publicados','Verificando','Horarios perdidos'].map((name,i)=>{const x=el('div',name,'stat');x.append(el('b',String(counts[i])));return x;}));
$('mode').textContent=status.publishing_enabled&&status.instagram_configured?'PUBLICACIÓN ACTIVADA':'MODO SEGURO · SIN PUBLICAR';$('mode').className=status.publishing_enabled&&status.instagram_configured?'pill ok':'pill bad';
$('warning').textContent=status.publishing_enabled&&status.instagram_configured?'Publicación habilitada. Las publicaciones solo salen tras la verificación de cuenta y cuota.':'Publicación desactivada o conexión Instagram pendiente. Los posts guardados NO se envían.';
$('assets').hidden=!status.r2_configured;
const list=$('posts');list.replaceChildren();for(const p of data){const li=el('li');const title=el('strong',p.title);li.append(title,el('div',dateNY(p.scheduled_ms)+' · '+statusText(p.status),'muted small'));if(p.permalink){const link=el('a','Ver en Instagram');link.href=p.permalink;link.rel='noopener noreferrer';link.target='_blank';li.append(link);}if(p.last_error)li.append(el('p',p.last_error,'error small'));if(['BLOCKED','MISSED'].includes(p.status)){
 const retry=el('button','Reprogramar','outline');retry.type='button';retry.addEventListener('click',async()=>{
 const date=prompt('Nueva fecha/hora ISO con zona de Nueva York (ej. 2026-10-15T20:15:00-04:00). Antes revisa que Meta esté conectado y la cuota disponible.');
 if(!date)return;try{await api('/api/posts/'+encodeURIComponent(p.id)+'/reschedule',{method:'POST',body:JSON.stringify({scheduled_at:date})});await refresh();}catch(err){alert(err.message);}
 });li.append(retry);
}if(p.status==='VERIFYING' && p.media_id){const retry=el('button','Verificar enlace','outline');retry.type='button';retry.addEventListener('click',async()=>{try{await api('/api/posts/'+encodeURIComponent(p.id)+'/recheck',{method:'POST'});await refresh();}catch(err){alert(err.message);}});li.append(retry);}
if(p.status==='SCHEDULED'){const btn=el('button','Cancelar','outline');btn.type='button';btn.addEventListener('click',async()=>{try{await api('/api/posts/'+encodeURIComponent(p.id)+'/cancel',{method:'POST'});await refresh();}catch(e){alert(e.message);}});li.append(btn);}list.append(li);}if(!data.length)list.append(el('li','Todavía no hay posts en la cola.','muted'));
const evt=$('events');evt.replaceChildren();for(const e of log){evt.append(el('li',dateNY(e.timestamp_ms)+' · '+e.action+(e.detail?' · '+e.detail:''),'muted small'));}if(!log.length)evt.append(el('li','Sin actividad registrada.','muted'));
}catch(e){$('warning').textContent='No se pudo actualizar: '+e.message;}}
if($('login'))$('login').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('pass').value})});location.href='/';}catch(err){$('notice').textContent=err.message;}});
if($('logout'))$('logout').addEventListener('click',async()=>{await api('/api/logout',{method:'POST'});location.href='/';});
if($('createPost')){$('createPost').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const d=Object.fromEntries(f.entries());d.images=String(d.images).split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);d.scheduled_at=new Date(d.scheduled_at).toISOString();try{await api('/api/posts',{method:'POST',body:JSON.stringify(d)});$('submitResult').textContent='Guardado correctamente. Todavía no equivale a publicado.';e.currentTarget.reset();await refresh();}catch(err){$('submitResult').textContent=err.message;}});
$('refresh').addEventListener('click',refresh);$('checkQuota').addEventListener('click',async()=>{try{const q=await api('/api/quota');$('quota').textContent='@'+q.profile.username+': '+q.quota.used+' de '+q.quota.total+' publicaciones usadas · '+q.quota.remaining+' disponibles';}catch(e){$('quota').textContent=e.message;}});
$('upload').addEventListener('click',async()=>{const file=$('file').files[0];if(!file)return;$('uploadResult').textContent='Subiendo…';try{const r=await fetch('/api/assets',{method:'POST',headers:{'Content-Type':file.type},body:file});const j=await r.json();if(!r.ok)throw new Error(j.error||'Error');const images=$('createPost').querySelector('[name=images]');images.value=(images.value.trim()?images.value.trim()+'\\n':'')+j.url;$('uploadResult').textContent='Imagen añadida. Introduce licencias y créditos.';}catch(e){$('uploadResult').textContent=e.message;}});
showSlots();refresh();setInterval(refresh,60000);}
`;
