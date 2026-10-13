import logging
import math

from fastapi import APIRouter, Request

from app import db
from app.http import error, read_json
from app.services.rag import generate_similar_questions
from app.utils import iso, js_number, new_cuid, utcnow

log = logging.getLogger(__name__)
router = APIRouter()

WRONG_COLUMNS = (
    'id, question, options, "myAnswer", "correctAnswer", explanation, topic, "examType", '
    '"createdAt", "reviewCount", "nextReview"'
)


def _serialize(row) -> dict:
    out = dict(row)
    out["createdAt"] = iso(out["createdAt"])
    out["nextReview"] = iso(out["nextReview"])
    return out


def _to_int(value, field: str) -> int:
    n = js_number(value)
    if not math.isfinite(n) or not n.is_integer():
        raise ValueError(f"{field} 값이 올바르지 않습니다.")
    return int(n)


@router.get("/wrong")
async def list_wrong():
    rows = await db.pool().fetch(f'SELECT {WRONG_COLUMNS} FROM "WrongAnswer" ORDER BY "createdAt" DESC')
    return {"items": [_serialize(r) for r in rows]}


@router.post("/wrong")
async def create_wrong(request: Request):
    b = await read_json(request)
    try:
        now = utcnow()
        row = await db.pool().fetchrow(
            f"""INSERT INTO "WrongAnswer"
                  (id, question, options, "myAnswer", "correctAnswer", explanation, topic, "examType",
                   "createdAt", "reviewCount", "nextReview")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $9)
                RETURNING {WRONG_COLUMNS}""",
            new_cuid(),
            b.get("question"),
            b.get("options"),
            _to_int(b.get("myAnswer"), "myAnswer"),
            _to_int(b.get("correctAnswer"), "correctAnswer"),
            b.get("explanation") or "",
            b.get("topic") or "",
            b.get("examType") or "",
            now,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("오답 저장 실패")
        return error(500, str(e) or "오답 저장 실패")
    return _serialize(row)


@router.delete("/wrong/{wrong_id}")
async def delete_wrong(wrong_id: str):
    try:
        await db.pool().execute('DELETE FROM "WrongAnswer" WHERE id = $1', wrong_id)
    except Exception:  # noqa: BLE001 - 기존 서버처럼 실패해도 ok 로 응답합니다.
        log.exception("오답 삭제 실패")
    return {"ok": True}


@router.post("/wrong/{wrong_id}/similar")
async def similar_questions(wrong_id: str, request: Request):
    row = await db.pool().fetchrow(f'SELECT {WRONG_COLUMNS} FROM "WrongAnswer" WHERE id = $1', wrong_id)
    if row is None:
        return error(404, "not found")

    body = await read_json(request)
    try:
        questions = await generate_similar_questions(dict(row), js_number(body.get("count") or 3))
        return {"questions": questions}
    except Exception as e:  # noqa: BLE001
        return error(500, str(e) or "유사 문제 생성 실패")
