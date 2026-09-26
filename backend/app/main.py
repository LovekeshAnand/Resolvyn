"""Resolvyn API entrypoint.

Run with: uvicorn app.main:app --port 8000
"""

import asyncio
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from app.agents import orchestrator
from app.api import telephony, ws
from app.api.router import api_router
from app.config import get_settings
from app.database import engine, init_db
from app.integrations import jira_sim
from app.llm import llm
from app.memory.memory_engine import memory
from app.models import Ticket
from app.services.seed_service import seed_all
from app.voice.tts import tts

settings = get_settings()

# Windows consoles default to cp1252; the agent's text has rupee signs and Hindi.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    created = seed_all()
    memory.reload()
    print(f"[startup] seed: {created}", flush=True)
    # sessions do not survive a restart: no ticket may claim a call is still active
    with Session(engine) as s:
        for t in s.exec(select(Ticket).where(Ticket.call_active == True)).all():  # noqa: E712
            t.call_active = False
            s.add(t)
        s.commit()
    orchestrator.reset_all()
    await llm.start()  # loads the local model in the background
    from app.services import email_service

    tasks = [asyncio.create_task(tts.warm()), asyncio.create_task(jira_sim.monitor()), asyncio.create_task(email_service.poll_mailbox())]
    yield
    for t in tasks:
        t.cancel()
    await llm.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # localhost, plus the hosted UI (Vercel) that calls this backend through an ngrok address
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?|https://[a-z0-9-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "operational", "service": settings.app_name, "llm_ready": llm.ready("fast")}


app.include_router(api_router)
app.include_router(ws.router)
app.include_router(telephony.router)
