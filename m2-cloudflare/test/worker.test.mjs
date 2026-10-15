import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {validatePost, safeHttpsUrl, issueSession, verifySession, nyTimeParts, SLOT_MINUTES, runScheduler} from '../src/worker.mjs';

const good = (scheduled_at='2026-10-15T21:15:00Z') => ({
  title: 'Hallazgo científico interesante confirmado',
  caption: 'Un hecho comprobado por fuentes oficiales. Imagen 1 y 2: licencia abierta.',
  source: 'https://science.nasa.gov/',
  rights: 'Fotografías NASA, uso autorizado, créditos NASA',
  images: ['https://images.nasa.gov/one.jpg','https://images.nasa.gov/two.jpg'],
  scheduled_at,
});
const reference = Date.parse('2026-10-15T19:00:00Z');

test('Los intervalos por cuarto de hora son los cuatro previstos', ()=>assert.deepEqual([...SLOT_MINUTES],[0,15,30,45]));
test('Acepta carrusel verificado en cuarto de hora NY',()=>{
  const p=validatePost(good(),reference);
  assert.equal(p.scheduled_at,Date.parse('2026-10-15T21:15:00Z'));
  assert.equal(p.images.length,2);
});
test('Impide horarios fuera de 00/15/30/45 NY',()=>assert.throws(()=>validatePost(good('2026-10-15T21:07:00Z'),reference),/minutos/));
test('Rechaza URL inseguras, localhost y redes internas',()=>{
  for(const u of ['http://site.com/img.jpg','https://localhost/a','https://127.0.0.1/x','https://192.168.1.1/x','https://169.254.169.254/x','https://user:pwd@example.com/x','https://[::1]/x'])
    assert.equal(safeHttpsUrl(u),false,u);
  assert.equal(safeHttpsUrl('https://nasa.gov/photo.jpg'),true);
});
test('Impide duplicados de imágenes insuficientes e información sin licencia',()=>{
  assert.throws(()=>validatePost({...good(),images:['https://nasa.gov/a.jpg']},reference),/2 a 10/);
  assert.throws(()=>validatePost({...good(),rights:'no'},reference),/licencia/);
});
test('Valida cuartos durante ambos lados del cambio horario de Nueva York',()=>{
  for(const offset of ['-04:00','-05:00']){
    const stamp=`2026-11-01T01:15:00${offset}`;
    assert.equal(nyTimeParts(stamp).minute,'15');
    assert.ok(validatePost(good(stamp),reference).scheduled_at>reference);
  }
});
test('Sesiones: firma, vencimiento y detección de cambios',async()=>{
  const k='d'.repeat(40),t=Date.UTC(2026,9,15,17);
  const token=await issueSession(k,t);
  assert.equal(await verifySession(k,token,t+1000),true);
  assert.equal(await verifySession(k,token+'x',t+1000),false);
  assert.equal(await verifySession(k,token,t+13*3600_000),false);
});
test('API /health no filtra secretos y /api/state requiere contraseña',async()=>{
  const env={ADMIN_PASSWORD:'long_password_for_testing',SESSION_KEY:'k'.repeat(40),DB:{},IG_USER_ID:'99',IG_ACCESS_TOKEN:'supersecret'};
  const r=await worker.fetch(new Request('https://app.example/health'),env);
  assert.equal(r.status,200);
  const s=await r.text();assert.equal(s.includes('supersecret'),false);
  const privateR=await worker.fetch(new Request('https://app.example/api/state'),env);
  assert.equal(privateR.status,401);
});
test('Sin credenciales Meta, el programador nunca intenta publicar',async()=>{
  assert.deepEqual(await runScheduler({DB:{}},reference),{result:'NOT_CONNECTED'});
});
