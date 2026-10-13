import json

from app import db
from app.services.llm import EMBED_DIMENSIONS, EMBED_MODEL, create_chat_completion, get_embed_client
from app.utils import clamp, collapse_ws, fmt_num, js_number, num_or


async def embed(text: str) -> list[float]:
    res = await get_embed_client().embeddings.create(model=EMBED_MODEL, input=text, dimensions=EMBED_DIMENSIONS)
    return res.data[0].embedding


def vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(repr(float(v)) for v in vec) + "]"


def _row_chunk(r) -> dict:
    return {"content": r["content"], "source": r["source"], "page": r["page"]}


async def retrieve_chunks(query: str, top_k: int = 5, source: str = "") -> list[dict]:
    vector = vector_literal(await embed(query))
    if source:
        rows = await db.pool().fetch(
            """SELECT content, source, page
                 FROM "Chunk"
                WHERE source = $2
                ORDER BY embedding <=> $1::text::vector
                LIMIT $3""",
            vector,
            source,
            int(top_k),
        )
    else:
        rows = await db.pool().fetch(
            """SELECT content, source, page
                 FROM "Chunk"
                ORDER BY embedding <=> $1::text::vector
                LIMIT $2""",
            vector,
            int(top_k),
        )
    return [_row_chunk(r) for r in rows]


async def sample_chunks(source: str, limit=12) -> list[dict]:
    """시험(과목) 모드용: 자연어 검색 없이 선택한 과목(파일) 전반에서 청크를 무작위로 추출합니다.
    매 시험마다 다른 청크가 뽑혀 같은 과목이라도 출제 범위가 골고루 분산됩니다."""
    take = int(clamp(num_or(limit, 12), 4, 24))
    if source:
        rows = await db.pool().fetch(
            """SELECT content, source, page
                 FROM "Chunk"
                WHERE source = $1
                ORDER BY random()
                LIMIT $2""",
            source,
            take,
        )
    else:
        rows = await db.pool().fetch(
            """SELECT content, source, page
                 FROM "Chunk"
                ORDER BY random()
                LIMIT $1""",
            take,
        )
    return [_row_chunk(r) for r in rows]


async def search_chunks_debug(query: str, top_k: int = 5, source: str = "") -> list[dict]:
    vector = vector_literal(await embed(query))
    limit = int(clamp(num_or(top_k, 5), 1, 20))
    if source:
        rows = await db.pool().fetch(
            """SELECT id, source, page, content, (embedding <=> $1::text::vector) AS distance
                 FROM "Chunk"
                WHERE source = $2
                ORDER BY embedding <=> $1::text::vector
                LIMIT $3""",
            vector,
            source,
            limit,
        )
    else:
        rows = await db.pool().fetch(
            """SELECT id, source, page, content, (embedding <=> $1::text::vector) AS distance
                 FROM "Chunk"
                ORDER BY embedding <=> $1::text::vector
                LIMIT $2""",
            vector,
            limit,
        )
    return [
        {
            "id": r["id"],
            "source": r["source"],
            "page": r["page"],
            "distance": float(r["distance"]) if r["distance"] is not None else None,
            "preview": collapse_ws(r["content"])[:240],
        }
        for r in rows
    ]


def _format_source_doc(chunks: list[dict], max_files: int = 3, max_pages_per_file: int = 8) -> str:
    by_source: dict[str, set[int]] = {}
    for c in chunks:
        key = c.get("source") or "unknown"
        pages = by_source.setdefault(key, set())
        if isinstance(c.get("page"), int):
            pages.add(c["page"])

    parts = []
    for source, page_set in list(by_source.items())[:max_files]:
        pages = sorted(page_set)
        limited = pages[:max_pages_per_file]
        suffix = ", …" if len(pages) > max_pages_per_file else ""
        parts.append(f"{source} (p.{', '.join(str(p) for p in limited)}{suffix})")

    return " · ".join(parts) if parts else "unknown"


async def retrieve(query: str, top_k: int = 5) -> str:
    vector = vector_literal(await embed(query))
    rows = await db.pool().fetch(
        """SELECT content, 1 - (embedding <=> $1::text::vector) AS similarity
             FROM "Chunk"
            ORDER BY embedding <=> $1::text::vector
            LIMIT $2""",
        vector,
        int(top_k),
    )
    return "\n\n".join(r["content"] for r in rows)


def _extract_json_candidate(raw: str) -> str:
    cleaned = str(raw or "").replace("```json", "").replace("```", "").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        return cleaned[start : end + 1]
    return cleaned


def _parse_questions(raw: str) -> list:
    candidate = _extract_json_candidate(raw)
    parsed = json.loads(candidate or "{}")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("questions"), list):
        raise ValueError("questions 배열이 없습니다.")
    return parsed["questions"]


async def _call_questions_model(prompt: str, max_retry: int = 1) -> list:
    last_err: Exception | None = None
    last_raw = ""

    for _ in range(max_retry + 1):
        last_raw = await create_chat_completion(
            messages=[{"role": "user", "content": prompt}],
            # GPT-5 계열은 추론(reasoning) 토큰까지 한도에 포함되므로 응답이 잘리지 않도록 여유를 크게 둡니다.
            # (reasoning_effort=minimal 와 함께, 최대 20문항 + LaTeX 해설까지 담을 수 있게 크게 잡습니다.)
            max_tokens=16000,
            # 유효한 JSON 객체를 강제해 파싱 실패를 줄입니다.
            response_format={"type": "json_object"},
        )
        try:
            return _parse_questions(last_raw)
        except ValueError as e:  # json.JSONDecodeError 도 ValueError
            last_err = e

    snippet = collapse_ws(last_raw)[:200]
    raise RuntimeError(
        f"문제 JSON 파싱 실패: {last_err or 'unknown'}"
        + (
            f" (모델 응답 일부: {snippet})"
            if snippet
            else " (모델 응답이 비어 있습니다 — 토큰 한도/추론으로 응답이 잘렸을 수 있습니다)"
        )
    )


def _with_source_doc(items: list, source_doc: str) -> list[dict]:
    return [{**q, "sourceDoc": source_doc} if isinstance(q, dict) else {"sourceDoc": source_doc} for q in items]


QUESTION_RULES = """- 보기(options)는 반드시 4개를 생성하세요.
- answer는 보기의 정답 번호로 0~3 정수로 출력하세요.
- 수식·분수는 반드시 LaTeX로 작성하세요. 인라인은 $...$, 분수는 \\frac{분자}{분모} 형태로 쓰고 슬래시(a/b) 표기는 쓰지 마세요. (문제·보기·해설 모두 동일)

출력 형식(JSON만):
{
  "questions": [
    {
      "question": "문제 텍스트",
      "options": ["①", "②", "③", "④"],
      "answer": 2,
      "explanation": "해설",
      "topic": "토픽",
      "difficulty": "상|중|하"
    }
  ]
}"""


async def generate_questions(topic: str, exam_type: str, count=5, source: str = "") -> list[dict]:
    chunks = await retrieve_chunks(topic, 8, source)
    context = "\n\n".join(c["content"] for c in chunks)
    source_doc = _format_source_doc(chunks)
    prompt = f"""당신은 IT 자격증 시험 출제 전문가입니다.
아래 내용을 바탕으로 {exam_type} 시험 스타일의 문제를 {fmt_num(js_number(count))}개 생성하세요.
사용자 요청을 최우선으로 반영하되, 반드시 참고 내용에 근거해서만 출제하세요.

[참고 내용]
{context}

[사용자 요청]
{topic}

규칙:
- 사용자 요청 범위 밖의 문제를 만들지 마세요.
- 참고 내용에서 근거를 찾을 수 없는 내용은 새로 지어내지 마세요.
{QUESTION_RULES}"""

    items = await _call_questions_model(prompt, 1)
    return _with_source_doc(items, source_doc)


async def generate_exam(source: str, exam_type: str, count=10) -> list[dict]:
    """시험(과목) 모드용: 자연어 명령 없이 선택한 과목(파일) 전체를 포괄하는 모의고사를 생성합니다."""
    n = int(clamp(num_or(count, 10), 1, 20))
    chunks = await sample_chunks(source, n + 4)
    context = "\n\n".join(c["content"] for c in chunks)
    source_doc = _format_source_doc(chunks)
    subject = source or "전체 자료"
    prompt = f"""당신은 IT 자격증 시험 출제 전문가입니다.
아래 [참고 내용]은 "{subject}" 과목 자료에서 발췌한 것입니다.
이 과목의 모의고사 문제를 {exam_type} 시험 스타일로 {n}개 생성하세요.

[참고 내용]
{context}

규칙:
- 특정 주제에 치우치지 말고 참고 내용 전반에서 골고루 출제하세요.
- 반드시 참고 내용에 근거해서만 출제하고, 근거 없는 내용은 새로 지어내지 마세요.
{QUESTION_RULES}"""

    items = await _call_questions_model(prompt, 1)
    return _with_source_doc(items, source_doc)


async def generate_similar_questions(wrong_answer: dict, count=3) -> list[dict]:
    chunks = await retrieve_chunks(wrong_answer["topic"], 3)
    context = "\n\n".join(c["content"] for c in chunks)
    source_doc = _format_source_doc(chunks)
    prompt = f"""학습자가 틀린 문제:
문제: {wrong_answer["question"]}
정답: {wrong_answer["correctAnswer"]}번
토픽: {wrong_answer["topic"]}

같은 개념을 다른 각도로 묻는 유사 문제 {fmt_num(js_number(count))}개를 JSON으로 생성하세요.

[참고 내용]
{context}"""

    items = await _call_questions_model(prompt, 1)
    return _with_source_doc(items, source_doc)
