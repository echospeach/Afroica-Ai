import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .database import Base, engine
from .routers import admin, auth, billing, chat, usage

# Baseline "error monitoring" with zero new dependencies or accounts: every
# unhandled exception is logged with a full traceback. Render (and most
# hosts) capture stdout/stderr in their own free log viewer, so this is
# visible without signing up for anything. If you want alerting/search on
# top of this later, an error-tracking service (e.g. Sentry) can hook into
# the handler below — swap the logger.exception() call for its SDK capture.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("afroica.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Afroica AI API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(auth.router)
app.include_router(usage.router)
app.include_router(billing.router)
app.include_router(chat.router)
app.include_router(admin.router)


@app.get("/")
def root():
    return {"service": "afroica-ai-api", "status": "ok"}
