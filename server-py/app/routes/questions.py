import logging

from fastapi import APIRouter, Request

from app import db
from app.http import error, read_json
from app.services.llm import get_llm_settings_snapshot
from app.services.rag import generate_exam, generate_questions, search_chunks_debug
from app.utils import clamp, js_number, new_cuid, normalize_answer_index

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/vector/search")
async def vector_search(query: str = "", source: str = "", topK: str = ""):
    try:
        query, source = query.strip(), source.strip()
        top_k = js_number(topK or 5)
        if not query:
            return error(400, "query 파라미터가 필요합니다.")

        rows = await search_chunks_debug(query, top_k, source)
        top_k_out = clamp(top_k, 1, 20)
        return {
            "query": query,
            "source": source,
            "topK": int(top_k_out) if float(top_k_out).is_integer() else top_k_out,
            "results": rows,
        }
    except Exception as e:  # noqa: BLE001
        log.exception("벡터 검색 실패")
        return error(500, str(e) or "벡터 검색 실패")


def _status_of(e: Exception) -> int | None:
    return getattr(e, "status_code", None) or getattr(e, "status", None)


@router.post("/questions/generate")
async def questions_generate(request: Request):
    try:
        body = await read_json(request)
        topic, command = body.get("topic"), body.get("command")
        exam_type = body.get("examType")
        count = body.get("count", 5)
        resolved_topic = str(command or topic or "").strip()
        resolved_source = str(body.get("source") or "").strip()
        if not exam_type:
            return error(400, "examType 필요")

        # 자연어 명령이 있으면 기존 방식(문제풀기), 없으면 과목(파일) 전체 기반 시험 생성.
        if resolved_topic:
            generated = await generate_questions(resolved_topic, exam_type, js_number(count), resolved_source)
        elif resolved_source:
            generated = await generate_exam(resolved_source, exam_type, js_number(count))
        else:
            return error(400, "command 또는 source 중 하나는 필요합니다.")

        questions = []
        for q in generated:
            saved = {
                "id": new_cuid(),
                "content": q.get("question"),
                "options": q.get("options"),
                "answer": normalize_answer_index(q.get("answer"), q.get("options")),
                "explanation": q.get("explanation") or "",
                "topic": q.get("topic") or resolved_topic or resolved_source,
                "difficulty": q.get("difficulty") or "중",
                "examType": exam_type,
                "sourceDoc": q.get("sourceDoc") or "rag-generated",
            }
            await db.pool().execute(
                """INSERT INTO "Question" (id, content, options, answer, explanation, topic, difficulty, "examType", "sourceDoc")
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                *saved.values(),
            )
            questions.append(
                {
                    "id": saved["id"],
                    "question": saved["content"],
                    "options": saved["options"],
                    "answer": saved["answer"],
                    "explanation": saved["explanation"],
                    "topic": saved["topic"],
                    "sourceDoc": saved["sourceDoc"],
                }
            )

        return {"questions": questions}
    except Exception as e:  # noqa: BLE001
        log.exception("문제 생성 실패")
        llm = get_llm_settings_snapshot()
        model_desc = f"{llm['label']} ({llm['provider']}/{llm['apiModel']})"
        status = _status_of(e)
        if status == 404:
            return error(404, f"현재 모델 호출 경로를 찾지 못했습니다(404). 모델/프로바이더 설정을 확인해 주세요: {model_desc}.")
        if status == 429:
            return error(
                429,
                f"요청 한도(429)를 초과했습니다. 현재 모델: {model_desc}. 잠시 후 다시 시도하거나 다른 모델로 변경해 주세요.",
            )
        return error(500, str(e) or "문제 생성 실패")
