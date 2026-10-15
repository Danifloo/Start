export function publishingPanel() {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GoNews · Preparar y revisar video</title>
<style>
body{font:16px/1.55 system-ui;background:#111820;color:#fff;margin:0}main{max-width:640px;margin:24px auto;padding:20px}
h1{line-height:1.15}input,textarea,select{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;font:inherit}
label{display:block;margin-top:16px}label input[type=checkbox]{width:auto;margin-right:8px}label:has(input:disabled){opacity:.6}
button{background:#ffd500;border:0;border-radius:8px;padding:13px;font:inherit;font-weight:700;margin-top:18px;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}video{width:100%;max-height:420px;background:#000;border-radius:10px}
a{color:#ffe265}.notice{padding:16px;border:1px solid #465365;border-radius:10px;background:#1c2632}.muted{color:#b7c5d6}
#message,#file-status{white-space:pre-wrap}fieldset{border:1px solid #465365;border-radius:10px;margin-top:22px;padding:16px}
[hidden]{display:none!important}textarea{min-height:100px}footer{margin-top:32px;border-top:1px solid #465365;padding-top:16px}
</style></head><body><main>
<p><a href="https://danifloo.github.io/Start/">GoNews Publisher</a></p>
<h1>Prepara y revisa tu video</h1>
<p class="notice">Puedes revisar un MP4 localmente. La publicación está bloqueada por configuración. Una conexión de Sandbox no significa que Production esté aprobado.</p>
<button id="load" type="button">Comprobar permisos de TikTok</button>
<p id="message" role="status" aria-live="polite">El archivo permanece en tu dispositivo hasta que autorices un envío habilitado.</p>
<p id="account" class="notice" hidden></p>
<form id="form">
<label for="video">Video MP4, hasta 30 MB</label><input id="video" type="file" accept="video/mp4,.mp4" required>
<p id="file-status" class="muted"></p><video id="preview" controls playsinline preload="metadata" hidden></video>
<label for="title">Descripción</label><textarea id="title" maxlength="2200" required placeholder="Escribe la descripción que acompañará al video"></textarea>
<label for="privacy">Privacidad</label><select id="privacy" required disabled><option value="">Selecciona una opción después de comprobar los permisos</option></select>
<fieldset><legend>Interacciones</legend><p class="muted">Todas están desactivadas inicialmente. TikTok puede limitar las opciones de tu cuenta.</p>
<label><input id="comment" type="checkbox" disabled> Permitir comentarios</label>
<label><input id="duet" type="checkbox" disabled> Permitir duetos</label>
<label><input id="stitch" type="checkbox" disabled> Permitir stitches</label></fieldset>
<fieldset><legend>Contenido comercial</legend>
<label><input id="commercial" type="checkbox"> Este video promociona una marca, producto o servicio</label>
<div id="commercial-options" hidden>
<label><input id="own-brand" type="checkbox"> Mi marca o negocio</label>
<label><input id="branded" type="checkbox"> Una marca ajena o colaboración pagada</label>
<p id="commercial-note" class="muted"></p></div></fieldset>
<label><input id="consent" type="checkbox" required> Tengo los derechos del video y autorizo enviarlo a la cuenta indicada.</label>
<label><input id="music-consent" type="checkbox" required> Al publicar, acepto la <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Confirmación de uso de música de TikTok</a>.</label>
<label id="branded-consent-label" hidden><input id="branded-consent" type="checkbox"> Al publicar, acepto la <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Política de contenido de marca de TikTok</a>.</label>
<p id="gate" class="notice">Publicación desactivada. Puedes preparar el video sin enviarlo.</p>
<button id="send" type="submit" disabled>Confirmar envío a TikTok</button>
</form>
<button id="check" type="button" hidden>Consultar estado del envío</button>
<footer><a href="https://danifloo.github.io/Start/privacy.html">Privacidad</a> · <a href="https://danifloo.github.io/Start/terms.html">Condiciones</a></footer>
</main><script>
const byId=id=>document.getElementById(id),msg=byId('message'),form=byId('form');
let creator=null,pid='',previewUrl='',duration=0,pollTimer=null,pollCount=0,busy=false;
const labels={PUBLIC_TO_EVERYONE:'Todo el mundo',MUTUAL_FOLLOW_FRIENDS:'Amigos',FOLLOWER_OF_CREATOR:'Seguidores',SELF_ONLY:'Solo yo'};
function update(){
  if(!byId('commercial').checked){byId('own-brand').checked=false;byId('branded').checked=false;byId('branded-consent').checked=false;}
  const commercial=byId('commercial').checked,branded=commercial&&byId('branded').checked;
  byId('commercial-options').hidden=!commercial;
  byId('branded-consent-label').hidden=!branded;byId('branded-consent').required=branded;
  const onlyMe=Array.from(byId('privacy').options).find(o=>o.value==='SELF_ONLY');
  if(onlyMe)onlyMe.disabled=branded;
  if(branded&&byId('privacy').value==='SELF_ONLY')byId('privacy').value='';
  byId('commercial-note').textContent=branded?'Se etiquetará como colaboración pagada. No puede tener visibilidad Solo yo.':byId('own-brand').checked?'Se etiquetará como contenido promocional.':'Indica qué marca promociona el video.';
  const file=byId('video').files[0],max=creator&&creator.max_video_post_duration_sec;
  const validFile=!!file&&file.size>0&&file.size<=30*1024*1024&&duration>0&&Number.isFinite(max)&&duration<=max;
  const brandValid=!commercial||byId('own-brand').checked||branded;
  const consent=byId('consent').checked&&byId('music-consent').checked&&(!branded||byId('branded-consent').checked);
  byId('send').disabled=busy||!creator||!creator.publishing_enabled||!validFile||!brandValid||!consent||!byId('privacy').value||!byId('title').value.trim();
}
byId('load').onclick=async()=>{
  creator=null;byId('privacy').disabled=true;byId('account').hidden=true;
  for(const id of ['comment','duet','stitch']){byId(id).checked=false;byId(id).disabled=true;}
  update();msg.textContent='Consultando permisos...';
  try{
    const r=await fetch('/creator-options',{cache:'no-store'}),j=await r.json();if(!r.ok)throw Error(j.error);
    creator=j;const p=byId('privacy');p.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='Selecciona la privacidad';p.append(empty);
    for(const name of j.privacy_level_options){const o=document.createElement('option');o.value=name;o.textContent=labels[name]||name;p.append(o);}
    p.value='';p.disabled=false;
    for(const [id,key] of [['comment','comment_disabled'],['duet','duet_disabled'],['stitch','stitch_disabled']]){byId(id).checked=false;byId(id).disabled=!!j[key];}
    byId('account').textContent='Cuenta: '+j.creator_nickname+' (@'+j.creator_username+') · Duración máxima: '+j.max_video_post_duration_sec+' segundos.';
    byId('account').hidden=false;byId('gate').textContent=j.publishing_enabled?'Revisa el video y elige los permisos. TikTok puede tardar unos minutos en procesarlo.':'Publicación desactivada por configuración. La conexión no acredita la aprobación de Production.';
    msg.textContent='Permisos consultados. No se ha enviado ningún video.';
  }catch(e){msg.textContent=e.message;byId('gate').textContent='Sin permisos de publicación verificados. Puedes preparar el video localmente.';}
  update();
};
byId('video').onchange=()=>{
  const v=byId('preview'),file=byId('video').files[0];duration=0;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';v.hidden=true;v.removeAttribute('src');v.load();
  if(!file){byId('file-status').textContent='';update();return;}
  if(!/\\.mp4$/i.test(file.name)||(file.type&&file.type!=='video/mp4')||!file.size||file.size>30*1024*1024){byId('file-status').textContent='Selecciona un MP4 de hasta 30 MB.';update();return;}
  previewUrl=URL.createObjectURL(file);v.src=previewUrl;v.hidden=false;byId('file-status').textContent='Vista previa local. Leyendo duración...';update();
};
byId('preview').onloadedmetadata=()=>{duration=byId('preview').duration;byId('file-status').textContent=Number.isFinite(duration)?'Duración: '+duration.toFixed(1)+' segundos. El archivo permanece en tu dispositivo.':'No se pudo leer la duración del video.';update();};
byId('preview').onerror=()=>{duration=0;byId('file-status').textContent='No se pudo abrir el MP4. Vuelve a exportarlo en formato compatible.';update();};
form.addEventListener('input',update);form.addEventListener('change',update);
form.onsubmit=async e=>{
  e.preventDefault();update();if(byId('send').disabled||!form.reportValidity())return;
  if(!confirm('¿Enviar este video a @'+creator.creator_username+' con privacidad '+(labels[byId('privacy').value]||byId('privacy').value)+'?'))return;
  busy=true;update();msg.textContent='Enviando a TikTok...';
  try{
    const data=new FormData();data.set('video',byId('video').files[0]);data.set('title',byId('title').value);data.set('privacy_level',byId('privacy').value);
    data.set('consent',byId('consent').checked?'yes':'no');data.set('music_consent',byId('music-consent').checked?'yes':'no');data.set('branded_consent',byId('branded-consent').checked?'yes':'no');
    for(const [key,id] of [['allow_comment','comment'],['allow_duet','duet'],['allow_stitch','stitch'],['commercial_content','commercial'],['own_brand','own-brand'],['branded_content','branded']])data.set(key,String(byId(id).checked));
    const r=await fetch('/submit-video',{method:'POST',body:data}),j=await r.json();if(!r.ok)throw Error(j.error);
    pid=j.publish_id;pollCount=0;byId('check').hidden=false;msg.textContent='TikTok recibió el video. Todavía no se ha confirmado la publicación; el procesamiento puede tardar unos minutos.';
    clearTimeout(pollTimer);pollTimer=setTimeout(checkStatus,5000);
  }catch(e){msg.textContent=e.message;}finally{busy=false;update();}
};
async function checkStatus(){
  clearTimeout(pollTimer);if(!pid)return;
  try{
    const r=await fetch('/posting-status?id='+encodeURIComponent(pid),{cache:'no-store'}),j=await r.json();if(!r.ok)throw Error(j.error);
    if(j.status==='PUBLISH_COMPLETE'){msg.textContent='TikTok confirmó la publicación. Su visibilidad depende de la privacidad elegida.';return;}
    if(j.status==='FAILED'){msg.textContent='TikTok no publicó el video: '+(j.fail_reason||'error de procesamiento');return;}
    msg.textContent='Estado de TikTok: '+j.status+'. La publicación todavía no está confirmada.';
    if(++pollCount<12)pollTimer=setTimeout(checkStatus,5000);else msg.textContent+=' Puedes volver a consultar el estado.';
  }catch(e){msg.textContent=e.message;}
}
byId('check').onclick=()=>{pollCount=0;checkStatus();};
window.addEventListener('pagehide',()=>{clearTimeout(pollTimer);if(previewUrl)URL.revokeObjectURL(previewUrl);});
</script></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  } });
}
