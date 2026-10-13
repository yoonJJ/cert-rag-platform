import base64
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator

import httpx
from openai import AsyncOpenAI

log = logging.getLogger(__name__)

# 임베딩은 OpenAI API 키로 수행합니다. DB의 vector(768) 컬럼과 맞추기 위해 768차원으로 요청합니다.
EMBED_MODEL = os.getenv("EMBED_MODEL") or "text-embedding-3-small"
EMBED_DIMENSIONS = int(os.getenv("EMBED_DIMENSIONS") or 768)

GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai"
ANTHROPIC_URL = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"


def _parse_option_list(raw: str | None, fallback: list[dict]) -> list[dict]:
    text = str(raw or "").strip()
    if not text:
        return fallback
    parsed = []
    for segment in text.split(","):
        s = segment.strip()
        if not s:
            continue
        if "|" not in s:
            parsed.append({"model": s, "label": s})
            continue
        model, label = s.split("|", 1)
        model, label = model.strip(), label.strip()
        if model:
            parsed.append({"model": model, "label": label or model})
    return parsed or fallback


OPENAI_DEFAULT = [
    {"model": "gpt-5", "label": "GPT-5 (OpenAI API)"},
    {"model": "gpt-5-mini", "label": "GPT-5 mini (OpenAI API)"},
    {"model": "gpt-5-nano", "label": "GPT-5 nano (OpenAI API)"},
    {"model": "gpt-4.1", "label": "GPT-4.1 (OpenAI API)"},
    {"model": "gpt-4.1-mini", "label": "GPT-4.1 mini (OpenAI API)"},
    {"model": "gpt-4o", "label": "GPT-4o (OpenAI API)"},
    {"model": "gpt-4o-mini", "label": "GPT-4o mini (OpenAI API)"},
]

GEMINI_DEFAULT = [
    {"model": "gemini-2.0-flash", "label": "Gemini 2.0 Flash (프리티어) (Gemini API)"},
    {"model": "gemini-1.5-flash", "label": "Gemini 1.5 Flash (프리티어) (Gemini API)"},
    {"model": "gemini-1.5-pro", "label": "Gemini 1.5 Pro (Gemini API)"},
]

CLAUDE_DEFAULT = [
    {"model": "claude-3-5-haiku-latest", "label": "Claude 3.5 Haiku (Claude API)"},
    {"model": "claude-3-5-sonnet-latest", "label": "Claude 3.5 Sonnet (Claude API)"},
]


def _with_provider(provider: str, o: dict) -> dict:
    return {"id": f"{provider}/{o['model']}", "provider": provider, "model": o["model"], "label": o["label"]}


OPTIONS = [
    *[_with_provider("openai", o) for o in _parse_option_list(os.getenv("OPENAI_CHAT_MODELS"), OPENAI_DEFAULT)],
    *[_with_provider("gemini", o) for o in _parse_option_list(os.getenv("GEMINI_CHAT_MODELS"), GEMINI_DEFAULT)],
    *[_with_provider("claude", o) for o in _parse_option_list(os.getenv("CLAUDE_CHAT_MODELS"), CLAUDE_DEFAULT)],
]
OPTION_BY_ID = {o["id"]: o for o in OPTIONS}


def _pick_initial_option_id() -> str | None:
    env = str(os.getenv("CHAT_MODEL") or "").strip()
    if env and env in OPTION_BY_ID:
        return env
    return OPTIONS[0]["id"] if OPTIONS else None


_current_option_id = _pick_initial_option_id()
_provider_api_keys = {
    "openai": str(os.getenv("OPENAI_API_KEY") or "").strip(),
    "gemini": str(os.getenv("GEMINI_API_KEY") or "").strip(),
    "claude": str(os.getenv("CLAUDE_API_KEY") or "").strip(),
}


def _current_option() -> dict:
    return OPTION_BY_ID.get(_current_option_id) or OPTIONS[0]


def _key_hint(value: str) -> str | None:
    return f"…{value[-4:]}" if value else None


# GPT-5 / o 시리즈 등 추론(reasoning) 모델 여부. 이 모델들은 추론 토큰이
# 출력 한도(max_completion_tokens)를 잠식해, 한도가 작으면 추론에 다 쓰여
# 응답 content 가 빈 문자열로 돌아옵니다. 출제·캡셔닝·전사는 깊은 추론이
# 필요 없으므로 'minimal' 로 두어 거의 모든 토큰을 출력에 할당합니다.
def _is_reasoning_model(model: str) -> bool:
    return bool(re.match(r"^(gpt-5|o\d)", str(model or "")))


REASONING_EFFORT = "minimal"


def get_embed_client() -> AsyncOpenAI:
    # 임베딩 제공자를 EMBED_BASE_URL 로 바꿔 끼울 수 있습니다(OpenAI 호환 엔드포인트).
    # 예: 로컬 Ollama nomic-embed-text → EMBED_BASE_URL=http://localhost:11434/v1
    base_url = str(os.getenv("EMBED_BASE_URL") or "").strip()
    if base_url:
        return AsyncOpenAI(base_url=base_url, api_key=str(os.getenv("EMBED_API_KEY") or "ollama").strip())
    if not _provider_api_keys["openai"]:
        raise RuntimeError("임베딩을 위해 OpenAI API 키를 입력해 주세요.")
    return AsyncOpenAI(api_key=_provider_api_keys["openai"])


def _openai_client(purpose: str = "") -> AsyncOpenAI:
    if not _provider_api_keys["openai"]:
        raise RuntimeError(f"{purpose}OpenAI API 키를 입력해 주세요.")
    return AsyncOpenAI(api_key=_provider_api_keys["openai"])


def _gemini_client(purpose: str = "") -> AsyncOpenAI:
    if not _provider_api_keys["gemini"]:
        raise RuntimeError(f"{purpose}Gemini API 키를 입력해 주세요.")
    return AsyncOpenAI(base_url=GEMINI_BASE_URL, api_key=_provider_api_keys["gemini"])


def get_chat_options() -> list[dict]:
    return OPTIONS


def set_chat_model(option_id) -> str:
    global _current_option_id
    oid = str(option_id or "").strip()
    if oid not in OPTION_BY_ID:
        raise ValueError("지원하지 않는 모델입니다.")
    _current_option_id = oid
    return _current_option_id


def set_provider_api_key(provider: str, key) -> bool:
    if provider not in ("openai", "gemini", "claude"):
        raise ValueError("API 키를 저장할 수 없는 provider입니다.")
    _provider_api_keys[provider] = str(key if key is not None else "").strip()
    return bool(_provider_api_keys[provider])


def has_provider_api_key(provider: str) -> bool:
    return bool(_provider_api_keys.get(provider))


# ---------- Anthropic (Claude) ----------

def _anthropic_headers() -> dict:
    return {
        "content-type": "application/json",
        "x-api-key": _provider_api_keys["claude"],
        "anthropic-version": ANTHROPIC_VERSION,
    }


def _to_anthropic_request(messages: list[dict], max_tokens: int) -> dict:
    system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system").strip()
    converted = [
        {"role": "assistant" if m.get("role") == "assistant" else "user", "content": str(m.get("content") or "")}
        for m in messages
        if m.get("role") != "system"
    ]
    body = {"messages": converted, "max_tokens": max_tokens}
    if system:
        body["system"] = system
    return body


def _anthropic_error(data: dict, fallback: str) -> str:
    err = data.get("error") if isinstance(data, dict) else None
    if isinstance(err, dict) and err.get("message"):
        return err["message"]
    return (data or {}).get("message") or fallback


async def _anthropic_create(model: str, messages: list[dict], max_tokens: int | None) -> str:
    if not _provider_api_keys["claude"]:
        raise RuntimeError("Claude API 키를 입력해 주세요.")
    body = {"model": model, **_to_anthropic_request(messages, max_tokens or 1024), "stream": False}
    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0)) as client:
        res = await client.post(f"{ANTHROPIC_URL}/messages", headers=_anthropic_headers(), json=body)
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code >= 400:
        raise RuntimeError(_anthropic_error(data, "Claude 요청 실패"))
    return "".join((c or {}).get("text") or "" for c in data.get("content") or [])


async def _anthropic_stream(model: str, messages: list[dict], max_tokens: int | None) -> AsyncIterator[str]:
    if not _provider_api_keys["claude"]:
        raise RuntimeError("Claude API 키를 입력해 주세요.")
    body = {"model": model, **_to_anthropic_request(messages, max_tokens or 1024), "stream": True}
    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0)) as client:
        async with client.stream("POST", f"{ANTHROPIC_URL}/messages", headers=_anthropic_headers(), json=body) as res:
            if res.status_code >= 400:
                raw = await res.aread()
                try:
                    data = json.loads(raw)
                except ValueError:
                    data = {}
                raise RuntimeError(_anthropic_error(data, "Claude 스트리밍 요청 실패"))
            async for line in res.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    event = json.loads(payload)
                except ValueError:
                    continue  # ignore malformed chunk
                text = (event.get("delta") or {}).get("text") or (event.get("content_block") or {}).get("text") or ""
                if text:
                    yield text


# ---------- 채팅 ----------

async def create_chat_completion(
    messages: list[dict],
    max_tokens: int | None = None,
    response_format: dict | None = None,
) -> str:
    """현재 선택된 provider/모델로 채팅 요청을 보내고 응답 텍스트를 반환합니다."""
    opt = _current_option()
    model = opt["model"]

    if opt["provider"] == "openai":
        client = _openai_client()
        # 최신 OpenAI 모델(GPT-5 계열 등)은 max_tokens 대신 max_completion_tokens를 사용합니다.
        # 또한 추론(reasoning) 토큰이 출력 한도를 잠식해 응답이 비는 것을 막기 위해 추론 강도를 낮춥니다.
        kwargs: dict = {"model": model, "messages": messages}
        if max_tokens is not None:
            kwargs["max_completion_tokens"] = max_tokens
        if _is_reasoning_model(model):
            kwargs["reasoning_effort"] = REASONING_EFFORT
        if response_format:
            kwargs["response_format"] = response_format
        res = await client.chat.completions.create(**kwargs)
        ch = res.choices[0] if res.choices else None
        content = ch.message.content if ch and ch.message else None
        if not content:
            log.warning(
                "createChatCompletion 빈 응답 (model=%s, finish_reason=%s, usage=%s)",
                model,
                ch.finish_reason if ch else None,
                res.usage.model_dump_json() if res.usage else None,
            )
        return content or ""

    if opt["provider"] == "gemini":
        client = _gemini_client()
        kwargs = {"model": model, "messages": messages}
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        res = await client.chat.completions.create(**kwargs)
        return (res.choices[0].message.content if res.choices else None) or ""

    return await _anthropic_create(model, messages, max_tokens)


async def create_chat_completion_stream(messages: list[dict], max_tokens: int | None = None) -> AsyncIterator[str]:
    """현재 선택된 모델의 스트리밍 응답을 텍스트 조각 단위로 내보냅니다."""
    opt = _current_option()
    model = opt["model"]

    if opt["provider"] in ("openai", "gemini"):
        if opt["provider"] == "openai":
            client = _openai_client()
            kwargs: dict = {"model": model, "messages": messages, "stream": True}
            # 최신 OpenAI 모델(GPT-5 계열 등)은 max_tokens 대신 max_completion_tokens를 사용합니다.
            if max_tokens is not None:
                kwargs["max_completion_tokens"] = max_tokens
            if _is_reasoning_model(model):
                kwargs["reasoning_effort"] = REASONING_EFFORT
        else:
            client = _gemini_client()
            kwargs = {"model": model, "messages": messages, "stream": True}
            if max_tokens is not None:
                kwargs["max_tokens"] = max_tokens
        stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            text = chunk.choices[0].delta.content if chunk.choices and chunk.choices[0].delta else None
            if text:
                yield text
        return

    async for text in _anthropic_stream(model, messages, max_tokens):
        yield text


# ---------- 이미지 캡셔닝 ----------

VISION_PROMPT = """이 이미지는 학습/시험 자료(문제·수식·표 포함)의 한 페이지입니다. 시험 출제에 그대로 쓸 수 있도록 페이지 내용을 한국어로 "빠짐없이 전사"하세요. 요약·설명이 아니라 원문 그대로 옮기는 것이 목적입니다.

규칙:
- 모든 텍스트·문제·보기·수식·표를 생략 없이 전사하세요. "…", "(생략)", "이하 동일" 같은 축약을 절대 쓰지 마세요.
- 수식은 반드시 LaTeX 로 적으세요. 인라인 수식은 $...$ 사이, 독립된 식은 $$...$$ 사이에 넣습니다.
  · 분수는 \\frac{분자}{분모} 형태로 (예: $\\frac{T}{0.61}$, $E_\\gamma = \\frac{hc}{\\lambda}$). 절대 슬래시(a/b)로 쓰지 마세요.
  · 지수·첨자는 ^{} 와 _{} 로 (예: $10^{-19}$, $E_\\gamma$, $\\frac{\\mu_{en}}{\\rho}$)
  · 그리스문자·기호는 \\lambda, \\rho, \\Sigma, \\int 등으로
  · 계산 과정이 있으면 중간 단계와 최종 결과까지 모두 LaTeX 로 적으세요.
- 표/그래프/다이어그램은 항목·수치·관계를 빠짐없이 텍스트(필요하면 표 형식)로 옮기세요.
- 정말 판독이 불가능한 부분만 "[판독 불가]"로 표시하세요.
- 이미지에 없는 내용을 지어내지 마세요.
전사 결과 텍스트만 출력하세요(머리말·맺음말 없이)."""


async def caption_image(data: bytes, mime_type: str = "image/png", hint: str = "") -> str:
    """이미지를 현재 선택된 provider의 비전 모델로 분석해 "설명 텍스트"를 만듭니다.
    반환된 텍스트는 호출 측에서 기존 텍스트 청크와 동일하게 임베딩됩니다."""
    opt = _current_option()
    b64 = base64.b64encode(data).decode("ascii")
    prompt_text = f"{VISION_PROMPT}\n\n[추가 맥락]\n{hint}" if hint else VISION_PROMPT

    if opt["provider"] == "claude":
        if not _provider_api_keys["claude"]:
            raise RuntimeError("이미지 분석을 위해 Claude API 키를 입력해 주세요.")
        body = {
            "model": opt["model"],
            "max_tokens": 4000,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": b64}},
                    ],
                }
            ],
        }
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0)) as client:
            res = await client.post(f"{ANTHROPIC_URL}/messages", headers=_anthropic_headers(), json=body)
        try:
            payload = res.json()
        except ValueError:
            payload = {}
        if res.status_code >= 400:
            raise RuntimeError(_anthropic_error(payload, "이미지 분석 실패(Claude)"))
        return "".join((c or {}).get("text") or "" for c in payload.get("content") or []).strip()

    # openai / gemini: OpenAI 호환 chat.completions + image_url(data URL)
    if opt["provider"] == "openai":
        client = _openai_client("이미지 분석을 위해 ")
    else:
        client = _gemini_client("이미지 분석을 위해 ")

    kwargs: dict = {
        "model": opt["model"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                ],
            }
        ],
    }
    # OpenAI 최신 모델은 max_completion_tokens, Gemini 호환 엔드포인트는 max_tokens 사용.
    if opt["provider"] == "openai":
        # GPT-5/o 계열은 추론 토큰이 출력 한도를 잠식하므로 한도를 크게 두고 추론 강도를 낮춥니다.
        # (한도가 작으면 추론에 다 쓰여 content 가 빈 문자열로 돌아옵니다.)
        kwargs["max_completion_tokens"] = 8000
        if _is_reasoning_model(opt["model"]):
            kwargs["reasoning_effort"] = REASONING_EFFORT
    else:
        kwargs["max_tokens"] = 4000

    res = await client.chat.completions.create(**kwargs)
    choice = res.choices[0] if res.choices else None
    out = ((choice.message.content if choice and choice.message else None) or "").strip()
    if not out:
        log.warning("captionImage 빈 응답 (model=%s, finish_reason=%s)", opt["model"], choice.finish_reason if choice else None)
    return out


# ---------- 설정 / 헬스체크 ----------

def get_llm_settings_snapshot() -> dict:
    opt = _current_option()
    providers = ("openai", "gemini", "claude")
    return {
        "optionId": _current_option_id,
        "provider": opt["provider"],
        "apiModel": opt["model"],
        "label": opt["label"],
        "keyStatus": {p: has_provider_api_key(p) for p in providers},
        "keyHints": {p: _key_hint(_provider_api_keys[p]) for p in providers},
    }


async def check_llm_health() -> dict:
    started = time.monotonic()
    opt = _current_option()

    def elapsed_ms() -> int:
        return round((time.monotonic() - started) * 1000)

    try:
        if opt["provider"] == "openai":
            if not _provider_api_keys["openai"]:
                raise RuntimeError("OpenAI API 키가 없습니다.")
            await AsyncOpenAI(api_key=_provider_api_keys["openai"]).models.list()
        elif opt["provider"] == "gemini":
            if not _provider_api_keys["gemini"]:
                raise RuntimeError("Gemini API 키가 없습니다.")
            await AsyncOpenAI(base_url=GEMINI_BASE_URL, api_key=_provider_api_keys["gemini"]).models.list()
        else:
            if not _provider_api_keys["claude"]:
                raise RuntimeError("Claude API 키가 없습니다.")
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                r = await client.get(f"{ANTHROPIC_URL}/models", headers=_anthropic_headers())
            if r.status_code >= 400:
                raise RuntimeError("Claude API 연결 실패")

        latency = elapsed_ms()
        return {
            "ok": True,
            "state": "degraded" if latency > 1800 else "connected",
            "latencyMs": latency,
            "model": opt["model"],
            "provider": opt["provider"],
        }
    except Exception as err:  # noqa: BLE001 - 헬스체크는 어떤 실패든 down 으로 보고합니다.
        return {
            "ok": False,
            "state": "down",
            "latencyMs": elapsed_ms(),
            "model": opt["model"],
            "provider": opt["provider"],
            "error": str(err) or "LLM health check failed",
        }
