import os

import bcrypt

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_dummy")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "whsec_dummy")
os.environ.setdefault("STRIPE_PRICE_MONTHLY", "price_monthly_dummy")
os.environ.setdefault("STRIPE_PRICE_YEARLY", "price_yearly_dummy")
os.environ.setdefault("ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("ADMIN_JWT_SECRET", "test-admin-secret")
os.environ.setdefault("ADMIN_PASSWORD", "admin-hunter22")  # plaintext, test-only convenience
os.environ.setdefault(
    "ADMIN_PASSWORD_HASH",
    bcrypt.hashpw(os.environ["ADMIN_PASSWORD"].encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.rate_limit import _attempts as _rate_limit_attempts


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    # The rate limiter's state is a module-level dict keyed by (path, IP) —
    # FastAPI's TestClient always reports the same fake IP, so without this
    # reset, calls from earlier tests would count against later ones and
    # start failing them with 429s once the cumulative total crossed a
    # limit, regardless of which test is actually running.
    _rate_limit_attempts.clear()
    yield


@pytest.fixture()
def client():
    # A fresh in-memory SQLite DB per test, shared across connections via
    # StaticPool (plain sqlite:///:memory: gives each connection its own
    # empty DB, which breaks FastAPI's per-request session).
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_headers(client):
    client.post("/auth/signup", json={"email": "test@example.com", "password": "hunter22"})
    resp = client.post("/auth/login", json={"email": "test@example.com", "password": "hunter22"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def admin_auth_headers(client):
    resp = client.post(
        "/admin/auth/login",
        json={"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]},
    )
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
