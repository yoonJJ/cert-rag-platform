# .env 를 다른 모듈(llm 설정 등)보다 먼저 읽어야 합니다.
from dotenv import load_dotenv

load_dotenv()

import logging  # noqa: E402
import os  # noqa: E402
import time  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from app import db  # noqa: E402
from app.routes import exam, questions, settings, tutor, upload, wrong  # noqa: E402
from app.services.llm import check_llm_health  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.connect()
    await db.ensure_schema()
    yield
    await db.disconnect()


app = FastAPI(title="cert-rag-platform API", lifespan=lifespan)

# Express 의 cors({ origin: true }) 와 같이 요청 Origin 을 그대로 허용합니다.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_error(_request: Request, exc: Exception):
    logging.getLogger(__name__).exception("unhandled error")
    return JSONResponse({"error": str(exc) or "Internal Server Error"}, status_code=500)


@app.get("/api/health")
async def health():
    started = time.monotonic()
    try:
        await db.pool().fetchval("SELECT 1")
        db_status = {"ok": True, "state": "connected"}
    except Exception:  # noqa: BLE001
        db_status = {"ok": False, "state": "down"}
    db_status["latencyMs"] = round((time.monotonic() - started) * 1000)

    llm_status = await check_llm_health()
    return {
        "ok": db_status["ok"] and llm_status["ok"],
        "db": db_status["ok"],
        "llm": llm_status["ok"],
        "dbStatus": db_status,
        "llmStatus": llm_status,
    }


for module in (upload, questions, exam, tutor, wrong, settings):
    app.include_router(module.router, prefix="/api")
