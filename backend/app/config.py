from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Local dev default only — every deployment MUST set a real DATABASE_URL
    # (a Postgres connection string, e.g. from Neon) since Render's free web
    # service disk is ephemeral and would silently drop the SQLite file.
    database_url: str = "sqlite:///./afroica_dev.db"

    # Local dev default only — every deployment MUST set a real JWT_SECRET.
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30

    # Admin dashboard — a single operator identity via env vars, not a DB
    # table. Signed with its own secret (never JWT_SECRET) so a regular
    # user's token can never validate against admin routes even in
    # principle. See backend/.env.example for how to generate the hash.
    admin_email: str = ""
    admin_password_hash: str = ""
    admin_jwt_secret: str = "dev-only-insecure-admin-secret-change-me"
    admin_jwt_expire_days: int = 7

    # Password-reset emails. If unset, reset links are logged to the server
    # console instead of sent — fully functional for local dev, zero cost,
    # zero account needed. Resend has a genuinely free tier (100/day) if you
    # want real delivery — see README. Nothing here costs money until you
    # set a real RESEND_API_KEY.
    resend_api_key: str = ""
    email_from: str = "Afroica AI <onboarding@resend.dev>"

    anthropic_api_key: str = ""

    # Free-tier fast path (see routers/chat.py POST /chat/free-stream) —
    # genuinely free, no-card-required inference on Groq's shared org-wide
    # quota. If unset, the free tier just falls back to on-device WebLLM
    # immediately, same as before this existed — nothing breaks without it.
    groq_api_key: str = ""

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_monthly: str = ""
    stripe_price_yearly: str = ""

    # Where Stripe Checkout/Portal send the browser back to.
    frontend_url: str = "http://localhost:8080"

    # Comma-separated list of allowed browser origins for CORS. Includes
    # the admin dashboard's default local dev port (8081) alongside the
    # main app's (8080) — see admin/README notes for serving it locally.
    cors_origins: str = (
        "http://localhost:8080,http://127.0.0.1:8080,"
        "http://localhost:8081,http://127.0.0.1:8081"
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
