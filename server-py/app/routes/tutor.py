import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.llm import create_chat_completion_stream
from app.services.rag import retrieve

log = logging.getLogger(__name__)
router = APIRouter()


def _sse(payload) -> str:
    data = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"data: {data}\n\n"


@router.get("/tutor")
async def tutor(question: str | None = None, wrongAnswer: str | None = None, correctAnswer: str | None = None, topic: str = ""):
    # 기존 서버의 템플릿 문자열과 같게, 값이 없으면 'undefined' 로 들어갑니다.
    def s(v):
        return "undefined" if v is None else v

    async def events():
        try:
            context = await retrieve(topic or "", 5)
            stream = create_chat_completion_stream(
                messages=[
                    {"role": "system", "content": f"당신은 IT 자격증 전문 튜터입니다.\n\n[참고 내용]\n{context}"},
                    {
                        "role": "user",
                        "content": f"문제: {s(question)}\n내가 고른 답: {s(wrongAnswer)}\n정답: {s(correctAnswer)}\n\n왜 틀렸는지 설명해줘.",
                    },
                ]
            )
            async for text in stream:
                yield _sse({"text": text})
            yield _sse("[DONE]")
        except Exception as e:  # noqa: BLE001
            log.exception("튜터 스트리밍 실패")
            yield _sse({"error": str(e)})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
