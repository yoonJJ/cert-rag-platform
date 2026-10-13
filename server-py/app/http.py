"""Express 서버와 같은 형태로 요청을 읽고 응답을 돌려주는 헬퍼."""

from fastapi import Request
from fastapi.responses import JSONResponse


async def read_json(request: Request) -> dict:
    """본문이 없거나 JSON 이 아니면 Express(express.json) 처럼 빈 객체로 취급합니다."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return body if isinstance(body, dict) else {}


def error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)
