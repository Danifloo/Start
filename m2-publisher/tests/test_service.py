import os
import tempfile
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Set only harmless local test values. Never contact Instagram in tests.
os.environ["ADMIN_PASSWORD"] = "example-admin-password-for-tests"
os.environ["SESSION_SECRET"] = "example-long-signed-session-secret-for-local-tests-only"
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="m2-test-")
os.environ.pop("IG_ACCESS_TOKEN", None)
os.environ.pop("IG_USER_ID", None)

from fastapi.testclient import TestClient
from service import app, safeurl

def test_rejects_non_public_urls():
    assert safeurl("https://www.nasa.gov/image.jpg")
    assert not safeurl("http://site.example/image.jpg")
    assert not safeurl("https://localhost/image.jpg")
    assert not safeurl("file:///tmp/secret")

def test_private_dashboard_and_queue():
    with TestClient(app) as c:
        unauth = c.get("/api/posts")
        assert unauth.status_code == 401
        wrong = c.post("/login", data={"password": "wrong"})
        assert wrong.status_code == 401
        login = c.post("/login", data={"password": os.environ["ADMIN_PASSWORD"]})
        assert login.status_code == 200
        assert "M2 PUBLISHER" in login.text

        ny = ZoneInfo("America/New_York")
        future = datetime.now(ny).replace(second=0,microsecond=0) + timedelta(hours=2)
        future = future.replace(minute=(future.minute//15)*15)
        payload = {
          "title": "Noticia de prueba única con fuentes",
          "caption": "Una noticia simulada de prueba para verificar la cola sin usar la API real.",
          "source": "https://www.nasa.gov/",
          "rights": "Fotografías con autorización verificada",
          "images": ["https://images.example.org/a.jpg", "https://images.example.org/b.jpg"],
          "scheduled_at": future.isoformat()
        }
        first = c.post("/api/posts", json=payload)
        assert first.status_code == 200, first.text
        duplicate = c.post("/api/posts", json=payload)
        assert duplicate.status_code == 409
        rows = c.get("/api/posts")
        assert rows.status_code == 200
        assert rows.json()[0]["status"] == "SCHEDULED"
        assert not rows.json()[0]["permalink"]
