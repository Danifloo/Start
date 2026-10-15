import {checkQuota,sameAccount} from './logic.js';
const DELAY_MS=2500;
const GRAPH_ROOT='https://graph.instagram.com';
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));

export function instagramConfigured(env) {
  return Boolean(env.IG_USER_ID && env.IG_ACCESS_TOKEN && env.IG_EXPECTED_USERNAME);
}

export async function graph(env,method,path,fields={}) {
  if(!instagramConfigured(env)) throw new Error('Instagram no está autorizado; faltan los secretos oficiales.');
  const version=String(env.META_GRAPH_VERSION||'v25.0');
  if(!/^v\d+\.\d+$/.test(version)) throw new Error('Versión Graph API inválida.');
  const url=new URL(`${GRAPH_ROOT}/${version}/${String(path).replace(/^\//,'')}`);
  const values={...fields,access_token:env.IG_ACCESS_TOKEN};
  let options={method,headers:{'Accept':'application/json'}};
  if(method==='GET') for(const [k,v] of Object.entries(values))url.searchParams.set(k,String(v));
  else {
    const body=new URLSearchParams();
    for(const [k,v] of Object.entries(values)) body.set(k,String(v));
    options.body=body;
    options.headers['Content-Type']='application/x-www-form-urlencoded';
  }
  let res;
  try{res=await fetch(url.toString(),options);}catch(e){throw new Error('Respuesta incierta de la red Meta: '+String(e).slice(0,140));}
  let payload;
  try{payload=await res.json();}catch{throw new Error('Meta devolvió una respuesta no válida.');}
  if(!res.ok||payload.error){throw new Error('Meta: '+String(payload.error?.message||`HTTP ${res.status}`).slice(0,230));}
  return payload;
}

export async function verifyAccountAndQuota(env) {
  const profile=await graph(env,'GET','me',{fields:'id,username'});
  if(!sameAccount(profile,env.IG_USER_ID,env.IG_EXPECTED_USERNAME)) {
    throw new Error('La cuenta autorizada no coincide con @maqued2; operación bloqueada.');
  }
  const data=await graph(env,'GET',`${env.IG_USER_ID}/content_publishing_limit`,{fields:'quota_usage,config'});
  return {profile:{id:profile.id,username:profile.username},quota:checkQuota(data)};
}

async function awaitContainer(env,id) {
  for(let i=0;i<12;i++) {
    const r=await graph(env,'GET',id,{fields:'status_code'});
    if(r.status_code==='FINISHED')return;
    if(['ERROR','EXPIRED'].includes(r.status_code)) throw new Error(`Meta rechazó el contenedor: ${r.status_code}`);
    await sleep(DELAY_MS);
  }
  throw new Error('Meta aún procesa el contenedor. No se repetirá automáticamente.');
}

/** Persists container and media identifiers BEFORE and AFTER irreversible publish call. */
export async function publishCarousel(env,post,record) {
  const check=await verifyAccountAndQuota(env);
  if(!check.quota.available) throw new Error('Cuota de publicación de Meta agotada.');
  const images=JSON.parse(post.images_json);
  if(images.length<2||images.length>10)throw new Error('El carrusel requiere 2–10 imágenes.');
  const children=[];
  for(const imageUrl of images){
    const item=await graph(env,'POST',`${env.IG_USER_ID}/media`,{'image_url':imageUrl,'is_carousel_item':'true'});
    if(!item.id) throw new Error('Meta no entregó el ID de imagen.');
    children.push(item.id);
  }
  for(const id of children)await awaitContainer(env,id);
  const outer=await graph(env,'POST',`${env.IG_USER_ID}/media`,{
    media_type:'CAROUSEL',children:children.join(','),caption:post.caption
  });
  if(!outer.id)throw new Error('Meta no entregó el ID de carrusel.');
  await record('VERIFYING',{container_id:outer.id});
  await awaitContainer(env,outer.id);
  // All subsequent errors are ambiguous; do NOT retry media_publish automatically.
  const published=await graph(env,'POST',`${env.IG_USER_ID}/media_publish`,{creation_id:outer.id});
  if(!published.id)throw new Error('Resultado incierto: Meta no entregó ID de publicación.');
  await record('VERIFYING',{media_id:published.id});
  return published.id;
}

export async function getPermalink(env,mediaId) {
  const data=await graph(env,'GET',mediaId,{fields:'id,permalink'});
  const link=String(data.permalink||'');
  try {
    const u=new URL(link);
    if(!['www.instagram.com','instagram.com'].includes(u.hostname))return null;
    if(!/^\/(p|reel)\/[A-Za-z0-9_-]+\/?/.test(u.pathname))return null;
    if(u.protocol!=='https:')return null;
    return `https://www.instagram.com${u.pathname}`;
  } catch{return null;}
}
