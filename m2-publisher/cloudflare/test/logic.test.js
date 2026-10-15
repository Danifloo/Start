import test from 'node:test';
import assert from 'node:assert/strict';
import {isQuarterHour,parseScheduled,normalizeHeadline,publicHttpsUrl,validatePost,checkQuota,sameAccount} from '../src/logic.js';
const NOW=Date.parse('2026-10-15T17:00:00Z');
const valid={title:'NASA muestra una nueva tecnología espacial',caption:'Una noticia verificada con fuentes oficiales y fotos autorizadas. #M2NEWS',source_url:'https://www.nasa.gov/new-study',image_rights:'NASA contenido público según sus políticas de uso',images:['https://images.nasa.gov/photo1.jpg','https://images.nasa.gov/photo2.jpg'],scheduled_at:'2026-10-15T17:15:00Z'};
test('minutos cada cuarto de hora y offsets DST',()=>{
  assert.equal(isQuarterHour(Date.parse('2026-10-15T13:15:00-04:00')),true);
  assert.equal(isQuarterHour(Date.parse('2026-11-01T01:00:00-04:00')),true);
  assert.equal(isQuarterHour(Date.parse('2026-11-01T01:00:00-05:00')),true);
  assert.equal(isQuarterHour(Date.parse('2026-10-15T13:11:00-04:00')),false);
  assert.equal(parseScheduled(valid.scheduled_at,NOW),Date.parse(valid.scheduled_at));
  assert.throws(()=>parseScheduled('2026-10-15T13:11:00-04:00',NOW),/00, 15, 30 o 45/);
  assert.throws(()=>parseScheduled('2026-10-15T17:15:00',NOW),/zona horaria/);
  assert.throws(()=>parseScheduled('2026-10-15T17:00:00Z',NOW),/futuro/);
});
test('validaciones de fuente, fotos, derechos y titular',()=>{
  const post=validatePost(valid,NOW);
  assert.equal(post.images.length,2);
  assert.equal(normalizeHeadline('  hola   mundo  '),'hola mundo');
  assert.equal(publicHttpsUrl('http://example.com/image.jpg'),false);
  assert.equal(publicHttpsUrl('https://localhost/test'),false);
  assert.equal(publicHttpsUrl('https://127.0.0.1/test'),false);
  assert.equal(publicHttpsUrl('https://example.com/x'),true);
  assert.throws(()=>validatePost({...valid,images:[valid.images[0],valid.images[0]]},NOW),/repitas/);
  assert.throws(()=>validatePost({...valid,image_rights:'ninguno'},NOW),/créditos/);
  assert.throws(()=>validatePost({...valid,caption:'Hola'},NOW),/Descripción/);
});
test('limite de Meta fail closed y cuenta exacta',()=>{
  assert.deepEqual(checkQuota({data:[{quota_usage:4,config:{quota_total:50}}]}),{used:4,total:50,remaining:46,available:true});
  assert.equal(checkQuota({quota_usage:50,config:{quota_total:50}}).available,false);
  assert.throws(()=>checkQuota({}),/cuota real/);
  assert.equal(sameAccount({id:'123',username:'MaQuEd2'},'123','maqued2'),true);
  assert.equal(sameAccount({id:'123',username:'maqued2'},'456','maqued2'),false);
});
