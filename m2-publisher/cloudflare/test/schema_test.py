"""Check Cloudflare D1-compatible SQLite constraints without external libraries."""
import sqlite3
from pathlib import Path

sql = (Path(__file__).resolve().parent.parent / 'migrations/0001_initial.sql').read_text()
c = sqlite3.connect(':memory:')
c.executescript(sql)
post = ('id1','Titular noticia A','fp1','descripcion','https://example.com/a','Autor/licencia','["https://example.com/1.jpg","https://example.com/2.jpg"]',1_000_000,'SCHEDULED',1,1)
insert='INSERT INTO posts(id,title,story_key,caption,source_url,image_rights,images_json,scheduled_ms,status,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
c.execute(insert,post)
try:
    c.execute(insert,('id2','Titular noticia B','fp2',*post[3:7],1_000_000,'SCHEDULED',1,1))
    raise AssertionError('Allowed duplicate time slot')
except sqlite3.IntegrityError:
    pass
c.execute(insert,('id3','Titular noticia C','fp3',*post[3:7],1_900_000,'SCHEDULED',1,1))
claimed=c.execute("UPDATE posts SET status='SENDING',updated_ms=? WHERE id=(SELECT id FROM posts WHERE status='SCHEDULED' AND scheduled_ms<=? ORDER BY scheduled_ms LIMIT 1) AND status='SCHEDULED' RETURNING id",(1_000_000,1_000_000)).fetchone()
assert claimed == ('id1',),claimed
assert c.execute("SELECT count(*) FROM posts WHERE status='SENDING'").fetchone()[0] == 1
assert c.execute("UPDATE posts SET status='SENDING' WHERE id=(SELECT id FROM posts WHERE status='SCHEDULED' AND scheduled_ms<=? ORDER BY scheduled_ms LIMIT 1) AND status='SCHEDULED' RETURNING id",(1_000_000,)).fetchone() is None
print('D1 migration SQL/uniqueness/atomic claim checks: passed')
