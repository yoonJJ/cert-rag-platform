import logging

from fastapi import APIRouter, Request

from app import db
from app.http import error, read_json
from app.utils import iso, new_cuid, normalize_answer_index, utcnow

log = logging.getLogger(__name__)
router = APIRouter()


def _js_key(value) -> str:
    """JS 객체 키 조회(answers[q.id])와 같은 문자열 키."""
    if value is None:
        return "undefined"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


@router.post("/exam/grade")
async def exam_grade(request: Request):
    body = await read_json(request)
    questions = body.get("questions")
    answers = body.get("answers")
    exam_type = body.get("examType", "PDF기반")
    source = body.get("source", "")
    command = body.get("command", "")
    if not isinstance(questions, list) or not answers:
        return error(400, "questions, answers 필요")
    answer_map = answers if isinstance(answers, dict) else {}

    correct = 0
    details = []
    for idx, q in enumerate(questions):
        q = q if isinstance(q, dict) else {}
        picked = answer_map.get(_js_key(q.get("id")))
        normalized = normalize_answer_index(q.get("answer"), q.get("options"))
        ok = _is_number(picked) and picked == normalized
        if ok:
            correct += 1
        details.append(
            {
                "id": q.get("id"),
                "orderNo": idx + 1,
                "correct": ok,
                "picked": int(picked) if _is_number(picked) else -1,
                "answer": normalized,
                "question": q.get("question") or "",
                "options": q.get("options") if isinstance(q.get("options"), list) else [],
                "explanation": q.get("explanation") or "",
                "topic": q.get("topic") or "",
                "sourceDoc": q.get("sourceDoc") or "",
            }
        )

    total = len(questions)
    # JS Math.round 와 동일하게 .5 는 올림 처리합니다.
    percent = int(correct * 100 / total + 0.5) if total else 0
    try:
        attempt_id = new_cuid()
        async with db.pool().acquire() as conn, conn.transaction():
            await conn.execute(
                """INSERT INTO "ExamAttempt" (id, "examType", source, command, total, correct, percent, "createdAt")
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                attempt_id,
                str(exam_type or "PDF기반"),
                str(source or ""),
                str(command or ""),
                total,
                correct,
                percent,
                utcnow(),
            )
            await conn.executemany(
                """INSERT INTO "ExamAttemptItem"
                     (id, "attemptId", "orderNo", "questionId", question, options, picked, answer,
                      "isCorrect", explanation, topic, "sourceDoc")
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
                [
                    (
                        new_cuid(),
                        attempt_id,
                        d["orderNo"],
                        str(d["id"] or ""),
                        d["question"],
                        d["options"],
                        d["picked"],
                        d["answer"],
                        d["correct"],
                        d["explanation"],
                        d["topic"],
                        d["sourceDoc"],
                    )
                    for d in details
                ],
            )
        return {"correct": correct, "total": total, "percent": percent, "details": details, "attemptId": attempt_id}
    except Exception as e:  # noqa: BLE001
        log.exception("시험 결과 저장 실패")
        return error(500, str(e) or "시험 결과 저장 실패")


@router.get("/exam/attempts")
async def exam_attempts():
    try:
        rows = await db.pool().fetch(
            """SELECT id, "examType", source, command, total, correct, percent, "createdAt"
                 FROM "ExamAttempt" ORDER BY "createdAt" DESC LIMIT 100"""
        )
        return {"attempts": [{**dict(r), "createdAt": iso(r["createdAt"])} for r in rows]}
    except Exception as e:  # noqa: BLE001
        log.exception("시험 이력 조회 실패")
        return error(500, str(e) or "시험 이력 조회 실패")


@router.get("/exam/attempts/{attempt_id}")
async def exam_attempt_detail(attempt_id: str):
    try:
        row = await db.pool().fetchrow(
            """SELECT id, "examType", source, command, total, correct, percent, "createdAt"
                 FROM "ExamAttempt" WHERE id = $1""",
            attempt_id,
        )
        if row is None:
            return error(404, "attempt not found")
        items = await db.pool().fetch(
            """SELECT id, "orderNo", question, options, picked, answer, "isCorrect", explanation, topic, "sourceDoc"
                 FROM "ExamAttemptItem" WHERE "attemptId" = $1 ORDER BY "orderNo" ASC""",
            attempt_id,
        )
        attempt = {**dict(row), "createdAt": iso(row["createdAt"]), "items": [dict(i) for i in items]}
        return {"attempt": attempt}
    except Exception as e:  # noqa: BLE001
        log.exception("시험 상세 조회 실패")
        return error(500, str(e) or "시험 상세 조회 실패")
