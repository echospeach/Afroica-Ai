# Afroica AI

A chat app with a free tier that costs nothing to run and a paid tier that's
fast. Free users run a real language model entirely in their own browser
(WebLLM, on-device, zero server cost). Pro subscribers get routed to a
hosted Claude model on a small Python backend for near-instant, higher
quality, vision-capable responses — paid for by the subscription, not by you.

## How the two tiers work

| | Free | Pro (Monthly $6.99 / Yearly $59.99) |
|---|---|---|
| Where inference runs | Your browser (WebGPU) | Backend → Anthropic Claude Haiku 4.5 |
| Cost to you (the operator) | $0, always | Funded by the subscription |
| Speed | Limited by your device | Fast, server-side |
| Daily limit | 15 messages/day | Unlimited (soft fair-use cap) |
| Image understanding | No (text-only on-device model) | Yes |
| Requires an account | Yes (to enforce the daily cap) | Yes |

**Why the free tier lost image support:** it originally ran
Phi-3.5-vision-instruct (~3.95GB VRAM), which reliably triggered GPU
out-of-memory / device-lost errors on modest hardware. It now runs
Llama-3.2-3B-Instruct (~2.26GB VRAM, text-only) on desktop instead — a
deliberate reliability-over-features tradeoff.

**Desktop vs. mobile model:** `js/engine.js` picks between two model sizes
based on a `navigator.userAgent` mobile check — phones expose far less GPU
memory to the browser than desktop GPUs even on flagship hardware, so the
3B model reliably fails to load there even where WebGPU itself works.
Mobile gets gemma3-1b-it (~711MB VRAM) instead — noticeably lower reply
quality, but working beats not working. `DESKTOP_MODEL_ID` /
`MOBILE_MODEL_ID` in `js/engine.js` are the two places to change if you
want to try different models; VRAM requirements for every available option
are listed in MLC's
[prebuiltAppConfig](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts).

Both tiers share the same persona/behavior config (`persona.json`) and the
same frontend (`index.html` / `style.css` / `js/`). Switching tiers is just a
subscription status change — no separate app.

## Project structure

```
afroica-ai/
├── index.html              # markup only
├── style.css                # all styles
├── persona.json              # AI name, tone, expertise — shared by both tiers
├── assets/
│   └── logo.svg               # app logo — sidebar, hero, chat avatar, favicon
├── admin/                    # separate static app — usage & business metrics
│   ├── index.html               # admin login + dashboard (own login, not a user account)
│   ├── style.css                  # own copy of the palette — deliberately separate app
│   └── js/
│       ├── adminApi.js              # fetch wrapper + admin token (separate localStorage key)
│       └── adminMain.js               # login, stats/users fetch + render, signups chart
├── js/
│   ├── main.js                 # entry point: auth gate, send/receive flow, tier routing
│   ├── engine.js                 # WebLLM model id + engine creation (free tier)
│   ├── persona.js                  # loads persona.json, builds the system prompt (free tier)
│   ├── voice.js                     # Web Speech API mic controller
│   ├── image.js                      # client-side image downscaling before send
│   ├── chat.js                        # message bubble / typing-indicator rendering
│   ├── api.js                          # fetch wrapper + JWT storage for the backend
│   ├── auth.js                          # signup/login/logout
│   ├── account.js                        # cached "who's signed in, are they Pro" state
│   ├── usage.js                           # GET/POST /usage (free-tier daily cap)
│   ├── billing.js                          # Stripe Checkout / Billing Portal redirects
│   └── proChat.js                           # streams from the backend (Pro tier)
├── tools/
│   └── persona_builder.py    # Python CLI that writes persona.json
├── backend/                   # Python (FastAPI) — accounts, quotas, Stripe, Pro chat
│   ├── app/
│   │   ├── main.py               # app entrypoint, global error handler
│   │   ├── config.py               # env-driven settings
│   │   ├── database.py              # SQLAlchemy engine/session
│   │   ├── models.py                 # User, DailyUsage, Subscription, ImpersonationLog, PasswordResetToken
│   │   ├── schemas.py                 # request/response models
│   │   ├── security.py                 # password hashing, JWT, reset tokens
│   │   ├── deps.py                      # auth dependency
│   │   ├── plans.py                      # pricing/limits — tune numbers here
│   │   ├── llm.py                         # Anthropic client, persona.json → system prompt
│   │   ├── rate_limit.py                   # in-memory per-IP rate limiting
│   │   ├── email.py                         # Resend email, console fallback
│   │   └── routers/
│   │       ├── auth.py                      # signup/login/me/delete, forgot/reset password
│   │       ├── usage.py                      # daily quota tracking
│   │       ├── billing.py                     # Stripe checkout/portal/webhook
│   │       ├── chat.py                         # Pro streaming chat endpoint
│   │       └── admin.py                         # admin login, stats/users, user detail, impersonate
│   ├── tests/                              # pytest — no real Stripe/Anthropic calls needed
│   ├── tools/
│   │   └── set_admin_password.py             # the one place to set/change the admin password
│   ├── requirements.txt
│   ├── .env.example
│   └── render.yaml                       # Render.com deploy manifest
├── TERMS.md                   # draft ToS — fill in your details before publishing
├── PRIVACY.md                  # draft privacy policy — same caveat
└── README.md
```

Each file does one thing — if something breaks, the browser/server console
points at a specific small module, not a giant blob.

## Run it locally

You need both the frontend (static files) and the backend (FastAPI) running.

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate   # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env
# edit .env: at minimum set JWT_SECRET (see the comment in .env.example for
# how to generate one) and ANTHROPIC_API_KEY if you want the Pro path to work
uvicorn app.main:app --reload --port 8000
```

This uses SQLite locally (`afroica_dev.db`, gitignored) — no database setup
needed for local dev.

### 2. Frontend

```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`. (Must be served over HTTP, not opened as
a `file://` path — WebGPU, `fetch('persona.json')`, and the backend calls all
require it.) If you change the backend's port or deploy it, update
`API_BASE_URL` in `js/api.js` and `CORS_ORIGINS`/`FRONTEND_URL` in the
backend's `.env` to match.

You'll land on a sign-in screen — an account is required even for the free
tier, since the daily cap has to be enforced somewhere it can't be cleared
by wiping browser storage.

## Setting up Stripe (for the Pro tier)

You need a Stripe account (test mode is fine for development).

1. **Create two Prices** in the [Stripe Dashboard](https://dashboard.stripe.com/test/products) → Products:
   - "Afroica AI Pro — Monthly", recurring, $6.99/month
   - "Afroica AI Pro — Yearly", recurring, $59.99/year
   - Copy each Price ID (`price_...`) into `backend/.env` as `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
2. **Copy your test secret key** (`sk_test_...`) from **Developers → API keys** into `STRIPE_SECRET_KEY`.
3. **Forward webhooks to your local backend** with the [Stripe CLI](https://stripe.com/docs/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:8000/billing/webhook
   ```
   This prints a `whsec_...` value — put it in `STRIPE_WEBHOOK_SECRET`.
4. Restart the backend after editing `.env`.
5. Test the flow: sign up in the app → click **Upgrade** → choose a plan →
   complete Stripe's test checkout (card `4242 4242 4242 4242`, any future
   date/CVC) → you're redirected back and should see "Pro · unlimited".

Once deployed for real, register the webhook endpoint's live URL
(`https://your-backend/billing/webhook`) in the Stripe Dashboard instead of
using the CLI, and switch to live-mode keys.

## Admin dashboard

`admin/` is a separate static app for usage and business metrics — total
users, Free/Pro split, daily message volume, an estimated MRR, and a
searchable user list. **No conversation content is shown or stored** — free-
tier chats never touch the backend at all, and Pro-tier messages just stream
through without being saved.

The admin login is **not a user account** — it's a single operator identity
configured entirely via environment variables, with its own JWT secret, so a
regular user's token can never access it even in principle:

1. **First-time setup** — generate a separate JWT secret and add it along with `ADMIN_EMAIL` to `backend/.env`:
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
2. **Set (or change) the admin password** — `backend/tools/set_admin_password.py` is the one place to do this; it prompts for a new password (hidden input) and writes the bcrypt hash straight into `backend/.env` for you:
   ```bash
   cd backend
   .venv/Scripts/python.exe tools/set_admin_password.py
   # or, to also change the admin email in the same run:
   .venv/Scripts/python.exe tools/set_admin_password.py --email you@example.com
   ```
3. Restart the backend — env vars are only read at startup, so this is required both the first time and after every password change.
4. Serve `admin/` on its own port (already included in the default `CORS_ORIGINS`):
   ```bash
   cd admin
   python3 -m http.server 8081
   ```
   Then open `http://localhost:8081` and log in.

Clicking any row in the users table opens a **detail view**: joined date,
plan/status, total messages, and a 60-day usage-history chart — still no
chat content, just the same kind of usage data as the main table, over a
longer window.

### Impersonation ("log in as a user")

The detail view has an **Impersonate** button — logs the admin in as that
user, without their password, by issuing a real user access token (the
same kind a normal login produces) and opening the main app in a new tab
already signed in as them. This is a deliberately powerful capability, so:

- It requires a confirmation click every time ("Log in as {email}? This
  opens a new tab authenticated as them and is logged.").
- Every use is recorded server-side (`ImpersonationLog` table) and shows up
  in that user's detail view ("Times impersonated"), plus a `logger.warning`
  line in the backend's own logs.
- **Known tradeoff, not solved:** the handoff token briefly appears in the
  new tab's URL bar before the app strips it (`js/main.js` does this on
  load via `history.replaceState`) — the standard cost of any "magic link"
  style handoff. Fine for an operator-only tool; a one-time-use exchange
  endpoint would close this gap but is more machinery than this internal
  tool warrants.

In production, consider also restricting `/admin/*` at the infra level (an
IP allowlist, or a separate deploy not linked from the public site) as
defense in depth — the app-level auth is solid, but extra isolation for an
operator-only surface is cheap insurance. That's doubly true here given
what impersonation makes possible.

## Deploying

**Backend — Render.com (free tier) + Neon.tech (free Postgres):**
1. Create a free Postgres database at [neon.tech](https://neon.tech); copy its connection string into `DATABASE_URL`.
2. Push this repo to GitHub, then create a new **Web Service** on [Render](https://render.com) pointing at `backend/` — it picks up `backend/render.yaml` automatically. Set the env vars Render prompts for (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `STRIPE_*`, `FRONTEND_URL`, `CORS_ORIGINS`).
3. Render's free tier sleeps after inactivity (cold-start delay on the first request) — fine to start, upgrade once you have paying users.

**Backend — Railway (paid; no free tier suitable for this):** Railway's
free allowance (a one-time $5 trial credit, then $1/month) isn't enough to
run a backend + Postgres continuously — realistically this means Railway's
Hobby plan, **$5/month minimum**, billed to a card you add at signup. Use
this only if you've deliberately decided that cost is acceptable.
1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repo.
2. In the new service's **Settings → Source**, set **Root Directory** to `backend` — Railway will then pick up `backend/railway.toml` automatically (Nixpacks build, `uvicorn ... --port $PORT` start command).
3. **+ New → Database → Add PostgreSQL** in the same project. Railway provisions it and exposes a `DATABASE_URL` variable.
4. In the backend service's **Variables** tab, add `DATABASE_URL` as a reference to the Postgres service's `DATABASE_URL` (Railway's variable-reference picker does this for you), plus every other var from `backend/.env.example`: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `FRONTEND_URL`, `CORS_ORIGINS`, and optionally `RESEND_API_KEY`/`EMAIL_FROM`.
5. Railway assigns a public URL under **Settings → Networking → Generate Domain**. Once you have it: register `https://<that-domain>/billing/webhook` as a real webhook endpoint in the Stripe Dashboard (**Developers → Webhooks**, live mode) and put *that* endpoint's signing secret in `STRIPE_WEBHOOK_SECRET` — this replaces the local `stripe listen` step entirely; nothing runs on your machine once deployed.
6. Redeploy after any variable change — Railway does this automatically on save, but confirm the deploy log shows the new values took effect.

**Frontend:** any static host works (GitHub Pages, Netlify, Vercel, Render static site) — and none of them need to be Railway, even if the backend is; there's no reason to pay to serve static files. Just update `API_BASE_URL` in `js/api.js` to your deployed backend's URL first.

## Controlling AI behavior with Python

`persona.json` is what **both** tiers read to build their system prompt —
edit it directly, or use the CLI in `tools/`:

```bash
# interactive — prompts for each field, keeps current values on Enter
python tools/persona_builder.py

# non-interactive — set specific fields directly (handy for scripting)
python tools/persona_builder.py \
  --user-name "David" \
  --tone "warm, direct, a little playful" \
  --expertise "African languages,software engineering,music" \
  --instructions "Keep answers short unless I ask for detail."

# just print the current persona
python tools/persona_builder.py --show
```

The free tier's `js/persona.js` fetches `persona.json` fresh on every page
load; the Pro tier's `backend/app/llm.py` reads the same file on each
request. No Python runs while the app itself is in use outside of the
backend server — `persona_builder.py` is purely an editing tool.

## Requirements

- Chrome or Edge (desktop), latest version — needs **WebGPU** for the free tier
- Python 3.10+ for the backend and for `persona_builder.py`
- Free tier: first load downloads and caches the on-device model (~2-3 GB).
  Every load after that is near-instant and works offline.
- Pro tier: needs a real `ANTHROPIC_API_KEY` on the backend
  ([console.anthropic.com](https://console.anthropic.com)) — this is the one
  part of the system with real per-message cost, covered by subscriptions.
- Voice input needs a browser with the Web Speech API (Chrome/Edge); the mic
  button disables itself automatically if it's unsupported.
- The mic button needs microphone permission the first time you use it.
  Image attach just opens the normal file picker, no permission needed.

## Where to make changes

- **Change how the AI behaves** — `persona.json` (or `tools/persona_builder.py`).
- **Change pricing/limits** — `backend/app/plans.py`. One file, plain numbers.
- **Swap the free-tier model** — `MODEL_ID` / `CHAT_OPTS` in `js/engine.js`.
- **Swap the Pro-tier model** — `CHAT_MODEL_ID` in `backend/app/plans.py`.
- **Change the send/receive flow** — `sendMessage()` / `sendFreeMessage()` /
  `sendProMessage()` in `js/main.js`.
- **Change auth/billing logic** — `backend/app/routers/auth.py` and `billing.py`.
- **Change the look** — `style.css` (CSS variables at the top control colors).
- **Change the logo** — `assets/logo.svg`, referenced from `style.css` (sidebar, hero, chat avatar) and `index.html` (favicon).
- **Change what the admin dashboard shows** — `backend/app/routers/admin.py` (data) and `admin/js/adminMain.js` (rendering).

## Account self-service

- **Password reset** — "Forgot password?" on the sign-in screen emails a
  one-hour, single-use reset link (`backend/app/routers/auth.py`,
  `POST /auth/forgot-password` + `POST /auth/reset-password`). No email
  provider configured? The link gets logged to the backend console instead
  — fully functional for local dev, zero cost. See "Sending real emails"
  below to turn on real delivery.
- **Account deletion** — "Delete account" next to Log out permanently
  removes a user's record and usage history and cancels any active Stripe
  subscription first. Requires re-entering the password even though the
  request is already authenticated, since a stolen/leaked token alone
  shouldn't be enough to destroy an account.

### Sending real emails

Password-reset links work locally without any setup (they're logged to the
console). For real delivery, sign up at [resend.com](https://resend.com)
(free tier: 100 emails/day) and set `RESEND_API_KEY` and `EMAIL_FROM` in
`.env` — see `backend/.env.example`. Nothing here costs money until you set
a real key.

## Security notes

- Passwords are bcrypt-hashed, never logged.
- JWTs are signed with `JWT_SECRET` (30-day expiry) — **generate a real one**
  for any deployment; the default in `config.py` is dev-only and insecure.
- The Stripe webhook verifies its signature (`STRIPE_WEBHOOK_SECRET`) before
  trusting anything in the payload.
- Pro subscribers still hit a soft daily cap (`PRO_DAILY_SOFT_CAP` in
  `plans.py`, currently 150/day) so a leaked token or abusive script can't
  run up an unbounded API bill.
- Conversation history sent to Anthropic is trimmed to the most recent
  `MAX_HISTORY_MESSAGES` (`plans.py`, currently 20) — without this, a single
  long-running conversation gets more expensive with every turn, since the
  stateless API resends the full history on every message.
- The admin dashboard uses a completely separate JWT (`ADMIN_JWT_SECRET`,
  never `JWT_SECRET`) and isn't tied to any user account — **generate a real
  secret and a real password hash** for any deployment; the defaults in
  `config.py` are dev-only and insecure. See "Admin dashboard" above.
- `/auth/signup`, `/auth/login`, and `/admin/auth/login` are rate-limited
  per IP (`backend/app/rate_limit.py`, in-memory — correct for Render's
  single-instance free tier; swap for a Redis-backed limiter if you ever
  scale to multiple instances) so brute-forcing a password isn't free.
- Unhandled backend errors are caught by a global exception handler
  (`backend/app/main.py`) and logged with a full traceback server-side,
  while the client only ever sees a generic 500 — no stack traces or
  internals leak to users.
- Password-reset tokens are stored as a SHA-256 hash (not bcrypt — they're
  already high-entropy random values, so bcrypt's slowness buys nothing)
  and are single-use and 1-hour-expiring.
- `TERMS.md` and `PRIVACY.md` at the repo root are **drafts**, linked from
  the sign-in screen — read the notice at the top of each before publishing;
  they need your business details filled in and, ideally, a lawyer's eyes if
  you're taking real payments from real strangers.

## Next steps you might want

- Refresh tokens (current JWTs are long-lived, no rotation)
- A model picker so users can trade speed vs. quality
- Support multiple image attachments per message
- Text-to-speech so replies can be read aloud
- Live-refresh the Pro badge after Stripe checkout without a page reload
