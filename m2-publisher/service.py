"""M2 Publisher — single-process Instagram carousel queue.
Deploy with HTTPS, persistent DATA_DIR, Meta professional Instagram credentials.
Never bypass or guess the official API publication limit.
"""
import asyncio
import hmac
import json
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

TZ = ZoneInfo("America/New_York")
DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB = DATA_DIR / "queue.db"
LOGIN = os.getenv("ADMIN_PASSWORD", "")
SECRET = os.getenv("SESSION_SECRET", "")
IG_USER = os.getenv("IG_USER_ID", "")
IG_TOKEN = os.getenv("IG_ACCESS_TOKEN", "")
IG_VERSION = os.getenv("META_GRAPH_VERSION", "v25.0")
BASE = "https://graph.instagram.com/" + IG_VERSION
CANVA_TEMPLATE = "https://www.canva.com/d/QQTBlqObP3r0gt6"
if len(LOGIN) < 16 or len(SECRET) < 32:
    raise RuntimeError("Set ADMIN_PASSWORD (>=16 chars) and SESSION_SECRET (>=32 chars) before startup.")

def connect():
    c = sqlite3.connect(DB, timeout=20)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("""CREATE TABLE IF NOT EXISTS posts (
       id INTEGER PRIMARY KEY, title TEXT UNIQUE NOT NULL, caption TEXT NOT NULL,
       source TEXT NOT NULL, rights TEXT NOT NULL, images TEXT NOT NULL,
       scheduled TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'SCHEDULED',
       media_id TEXT, permalink TEXT, error TEXT, created TEXT NOT NULL)""")
    return c

with connect() as c:
    pass

def rows():
    with connect() as c:
        return [dict(x) for x in c.execute("SELECT * FROM posts ORDER BY scheduled DESC LIMIT 250")]

def safeurl(url):
    p = urlparse(url)
    return p.scheme == "https" and bool(p.netloc) and not (
        p.hostname in ("localhost", "127.0.0.1") or
        (p.hostname or "").endswith((".local", ".internal")))

class Post(BaseModel):
    title: str = Field(min_length=12, max_length=180)
    caption: str = Field(min_length=30, max_length=2200)
    source: str
    rights: str = Field(min_length=12)
    images: list[str] = Field(min_length=2, max_length=10)
    scheduled_at: datetime

def admin(request):
    if request.session.get("admin") is not True:
        raise HTTPException(401, "Acceso privado")
    return True

async def ig(method, path, *, params=None, data=None):
    if not IG_USER or not IG_TOKEN:
        raise RuntimeError("Conexión Instagram pendiente: configura IG_USER_ID e IG_ACCESS_TOKEN.")
    async with httpx.AsyncClient(timeout=50) as http:
        try:
            r = await http.request(method, BASE + "/" + path.lstrip("/"),
                params={"access_token": IG_TOKEN, **(params or {})}, data=data)
        except httpx.RequestError as e:
            raise RuntimeError("Respuesta incierta de Meta: comprobar manualmente antes de reintentar.") from e
        try: res = r.json()
        except Exception as e: raise RuntimeError("Meta no respondió con JSON.") from e
        if r.status_code >= 400 or res.get("error"):
            err = res.get("error") or {}
            raise RuntimeError("Meta: " + str(err.get("message", r.status_code))[:300])
        return res

async def publish(item):
    quota = await ig("GET", f"{IG_USER}/content_publishing_limit",
                     params={"fields": "quota_usage,config"})
    obj = (quota.get("data") or [quota])[0]
    config = obj.get("config") or {}
    used, total = obj.get("quota_usage"), config.get("quota_total")
    if used is None or total is None:
        raise RuntimeError("Meta no entregó cuota de publicación; no se publicará.")
    if int(used) >= int(total):
        raise RuntimeError("Cuota oficial de Instagram agotada.")
    media = json.loads(item["images"])
    children = []
    for url in media:
        v = await ig("POST", f"{IG_USER}/media",
                     data={"image_url":url, "is_carousel_item":"true"})
        children.append(v["id"])
    outer = await ig("POST", f"{IG_USER}/media",
                     data={"media_type":"CAROUSEL","children":",".join(children),
                           "caption":item["caption"]})
    container = outer["id"]
    for _ in range(20):
        check = await ig("GET", container, params={"fields":"status_code"})
        status = check.get("status_code")
        if status == "FINISHED":break
        if status in ("ERROR","EXPIRED"):
            raise RuntimeError("Meta rechazó contenedor: "+status)
        await asyncio.sleep(3)
    else:
        raise RuntimeError("Contenedor aún procesando; verificación manual, sin duplicar.")
    result = await ig("POST", f"{IG_USER}/media_publish", data={"creation_id":container})
    media_id = result["id"]
    with connect() as c:
        c.execute("UPDATE posts SET status='VERIFYING',media_id=? WHERE id=?",
                  (media_id,item["id"]))
    link = await ig("GET", media_id, params={"fields":"id,permalink"})
    permalink = link.get("permalink","")
    if not permalink.startswith("https://www.instagram.com/"):
        raise RuntimeError("Publicado sin enlace confirmado; verificar antes de marcar éxito.")
    with connect() as c:
        c.execute("UPDATE posts SET status='PUBLISHED',permalink=?,error=NULL WHERE id=?",
                  (permalink,item["id"]))

async def tick():
    if not IG_USER or not IG_TOKEN:return
    now = datetime.now(timezone.utc).isoformat()
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        item = c.execute("SELECT * FROM posts WHERE status='SCHEDULED' AND scheduled<=? ORDER BY scheduled LIMIT 1",(now,)).fetchone()
        if item:
            c.execute("UPDATE posts SET status='SENDING' WHERE id=?",(item["id"],))
    if item:
        try: await publish(dict(item))
        except Exception as e:
            # Never automatically retry an ambiguous publish request; prevent duplicate posts.
            with connect() as c:
                c.execute("UPDATE posts SET status='UNCERTAIN',error=? WHERE id=?",
                          (str(e)[:500],item["id"]))
    # A crash after SENDING stays SENDING/UNCERTAIN and requires verification.

async def worker():
    while True:
        try: await tick()
        except Exception: pass
        await asyncio.sleep(20)

@asynccontextmanager
async def lifespan(_):
    task = asyncio.create_task(worker())
    yield
    task.cancel()
    try: await task
    except asyncio.CancelledError: pass

app = FastAPI(title="M2 Publisher", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=SECRET, same_site="lax",
                   https_only=bool(os.getenv("PUBLIC_BASE_URL", "").startswith("https://")))

LOGIN_HTML = """<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>M2 Publisher · Acceso</title><style>
body{background:#10131a;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh}
form{background:#1d222c;padding:32px;border-radius:18px;width:min(340px,85vw)}
input,button{width:100%;padding:13px;border:0;border-radius:9px;margin:10px 0;box-sizing:border-box}
button{background:#ed8d2b;font-weight:bold}small{color:#aab}</style>
<form action='/login' method='post'><h1>M2 <span style='color:#ed8d2b'>PUBLISHER</span></h1>
<p>Panel privado de noticias</p><input name='password' type='password' placeholder='Contraseña' required>
<button>Entrar</button><small>Solo administradores autorizados</small></form></html>"""

DASH = """<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>M2 Publisher</title><style>
*{box-sizing:border-box}body{margin:0;background:#10131a;color:#fff;font:15px system-ui}
header{padding:20px;background:#1d222c;display:flex;justify-content:space-between}
main{max-width:980px;margin:auto;padding:20px}.accent{color:#f3aa44}
.card{background:#1d222c;border:1px solid #343a46;padding:22px;border-radius:16px;margin:15px 0}
input,textarea,button{width:100%;padding:11px;margin:7px 0;border-radius:9px;border:1px solid #4b5260}
input,textarea{background:#121722;color:#fff}button{background:#f3aa44;color:#181818;font-weight:700;cursor:pointer}
a{color:#f3aa44}li{margin:12px 0}small,.muted{color:#afb6c5}</style>
<header><b>M2 <span class='accent'>PUBLISHER</span></b><span>@maqued2 · Nueva York</span></header>
<main><h1>Centro de publicaciones</h1><p class='muted'>Cuenta profesional de Instagram · Programación cada 15 minutos</p>
<div class='card'><h2>Estado</h2><p id='stats'>Cargando…</p><a href='https://www.canva.com/d/QQTBlqObP3r0gt6' target='_blank'>Abrir plantilla Canva →</a></div>
<div class='card'><h2>Programar un carrusel</h2><small>Necesitas dos o más imágenes alojadas en HTTPS, de uso autorizado.</small>
<form id='form'><input name='title' placeholder='Título de noticia' required>
<textarea name='caption' placeholder='Descripción, créditos y hashtags' required></textarea>
<input name='source' placeholder='URL HTTPS de fuente verificable' required>
<input name='rights' placeholder='Licencias y créditos de imágenes' required>
<textarea name='images' placeholder='Una URL HTTPS de imagen por línea (2–10)' required></textarea>
<input name='scheduled_at' type='datetime-local' required><button>Programar</button></form>
<p id='notice' class='muted'></p></div><div class='card'><h2>Cola y publicaciones</h2><ul id='posts'></ul></div>
</main><script>
const $=x=>document.getElementById(x);
async function refresh(){
 const r=await fetch('/api/posts');if(!r.ok){location.href='/';return}
 const data=await r.json();$('stats').textContent='En cola: '+data.filter(x=>x.status==='SCHEDULED').length
 +' · Publicados: '+data.filter(x=>x.status==='PUBLISHED').length
 +' · Revisión necesaria: '+data.filter(x=>x.status==='UNCERTAIN').length;
 $('posts').innerHTML=data.map(x=>'<li><b>'+escapeHtml(x.title)+'</b> — '+x.status
 +(x.permalink?' · <a target="_blank" href="'+encodeURI(x.permalink)+'">Ver Instagram</a>':'')
 +(x.error?' · '+escapeHtml(x.error):'')+'</li>').join('')||'No hay posts todavía.';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('form').onsubmit=async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.target));
 const date=new Date(d.scheduled_at);d.scheduled_at=date.toISOString();
 d.images=d.images.trim().split(/\n+/).map(x=>x.trim()).filter(Boolean);
 const r=await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
 $('notice').textContent=r.ok?'Publicación programada.':'Error: '+JSON.stringify(await r.json());
 if(r.ok){e.target.reset();refresh()}
};
refresh();setInterval(refresh,60000)</script></html>"""

@app.post("/login")
async def login(request:Request):
    body = (await request.body()).decode()
    from urllib.parse import parse_qs
    supplied = parse_qs(body).get("password", [""])[0]
    if not hmac.compare_digest(supplied,LOGIN):
        raise HTTPException(401,"Contraseña incorrecta")
    request.session["admin"] = True
    return RedirectResponse("/",status_code=303)

@app.get("/", response_class=HTMLResponse)
def home(request:Request):
    return DASH if request.session.get("admin") else LOGIN_HTML

@app.get("/health")
def health():
    return {"status":"ok","instagram_configured":bool(IG_USER and IG_TOKEN)}

@app.get("/api/posts")
def get_posts(request:Request):
    admin(request)
    return rows()

@app.post("/api/posts")
def add_post(request:Request, post:Post):
    admin(request)
    if not safeurl(post.source) or any(not safeurl(u) for u in post.images):
        raise HTTPException(422,"Fuente e imágenes deben usar HTTPS público.")
    dt = post.scheduled_at
    if dt.tzinfo is None:
        raise HTTPException(422,"La fecha requiere zona horaria.")
    local = dt.astimezone(TZ)
    if local.minute not in (0,15,30,45) or local.second!=0:
        raise HTTPException(422,"Solo minutos 00, 15, 30 y 45.")
    stamp = dt.astimezone(timezone.utc).isoformat()
    if dt.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(422,"Programa una fecha futura.")
    try:
        with connect() as c:
            c.execute("INSERT INTO posts(title,caption,source,rights,images,scheduled,created) VALUES(?,?,?,?,?,?,?)",
                (post.title.strip(),post.caption,post.source,post.rights,json.dumps(post.images),stamp,
                 datetime.now(timezone.utc).isoformat()))
    except sqlite3.IntegrityError:
        raise HTTPException(409,"Tema u horario duplicado.")
    return {"ok":True,"scheduled_at":stamp,"status":"SCHEDULED"}
