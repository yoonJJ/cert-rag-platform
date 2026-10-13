import re
from bisect import bisect_right

from app.utils import collapse_ws


def _chunk_spans(normalized: str, chunk_size: int, overlap: int) -> list[tuple[int, int]]:
    """정규화된 텍스트를 자를 (start, end) 구간 목록."""
    spans: list[tuple[int, int]] = []
    start = 0
    length = len(normalized)

    while start < length:
        end = min(start + chunk_size, length)
        if end < length:
            piece = normalized[start:end]
            sentence = piece.rfind(". ")
            word = piece.rfind(" ")
            cut = sentence + 1 if sentence > 300 else word if word > 300 else len(piece)
            end = start + cut
        spans.append((start, end))
        if end >= length:
            break
        start = max(0, end - overlap)

    return spans


def chunk_text(text, chunk_size: int = 650, overlap: int = 100) -> list[str]:
    normalized = collapse_ws(text)
    if not normalized:
        return []
    return [normalized[s:e].strip() for s, e in _chunk_spans(normalized, chunk_size, overlap)]


def chunk_pages(pages: list[str], chunk_size: int = 650, overlap: int = 100) -> list[dict]:
    """페이지별 텍스트를 이어 붙여 chunk_text 와 같은 기준으로 자르고, 청크마다 실제 페이지 번호를 붙입니다.

    페이지 경계를 넘는 청크는 글자가 가장 많이 걸친 페이지를 `page` 로 삼습니다.
    반환: [{"content", "page", "pageStart", "pageEnd"}] (페이지는 1부터)
    """
    parts: list[str] = []
    starts: list[int] = []  # 정규화된 전체 텍스트에서 각 페이지가 시작하는 위치
    page_numbers: list[int] = []
    offset = 0
    for number, raw in enumerate(pages, start=1):
        text = collapse_ws(raw)
        if not text:
            continue
        if parts:
            offset += 1  # 페이지 사이 공백 한 칸
        starts.append(offset)
        page_numbers.append(number)
        parts.append(text)
        offset += len(text)

    normalized = " ".join(parts)
    if not normalized:
        return []

    def page_index_at(pos: int) -> int:
        return max(0, bisect_right(starts, pos) - 1)

    chunks = []
    for s, e in _chunk_spans(normalized, chunk_size, overlap):
        content = normalized[s:e].strip()
        if not content:
            continue
        first, last = page_index_at(s), page_index_at(max(s, e - 1))
        best, best_len = first, -1
        for i in range(first, last + 1):
            page_end = starts[i + 1] if i + 1 < len(starts) else len(normalized)
            overlap_len = min(e, page_end) - max(s, starts[i])
            if overlap_len > best_len:
                best, best_len = i, overlap_len
        chunks.append(
            {
                "content": content,
                "page": page_numbers[best],
                "pageStart": page_numbers[first],
                "pageEnd": page_numbers[last],
            }
        )
    return chunks


# ---------- 마크다운(rag_markdown.md) 구조 기반 청킹 ----------

_PAGE_MARK = re.compile(r"^<!--\s*page:\s*(\d+)\s*-->\s*$")
_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_IMAGE_LINE = re.compile(r"^\s*!\[[^\]]*\]\([^)]*\)\s*$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}")


def _md_blocks(md: str) -> list[dict]:
    """마크다운을 블록 단위로 나눕니다: heading / table / code / text. 각 블록은 실제 페이지 번호를 가집니다."""
    blocks: list[dict] = []
    page = 1
    para: list[str] = []
    lines = md.splitlines()

    def flush_para():
        text = "\n".join(para).strip()
        if text:
            blocks.append({"kind": "text", "text": text, "page": page})
        para.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        if m := _PAGE_MARK.match(line):
            flush_para()
            page = int(m.group(1))
        elif line.lstrip().startswith("```"):
            flush_para()
            j = i + 1
            while j < len(lines) and not lines[j].lstrip().startswith("```"):
                j += 1
            blocks.append({"kind": "code", "text": "\n".join(lines[i : j + 1]).strip(), "page": page})
            i = j
        elif m := _HEADING.match(line):
            flush_para()
            blocks.append({"kind": "heading", "text": line.strip(), "level": len(m.group(1)), "title": m.group(2), "page": page})
        elif line.lstrip().startswith("|"):
            flush_para()
            j = i
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            blocks.append({"kind": "table", "text": "\n".join(lines[i:j]).strip(), "page": page})
            i = j - 1
        elif _IMAGE_LINE.match(line):
            pass  # Marker 가 남긴 이미지 자리표시(![](_page_3_Picture_0.jpeg))는 검색에 쓸모가 없습니다.
        elif not line.strip():
            flush_para()
        else:
            para.append(line)
        i += 1
    flush_para()
    return blocks


def _split_block(block: dict, max_chars: int) -> list[dict]:
    """max_chars 를 넘는 블록을 나눕니다. 표는 머리 행을 반복하고, 코드블록은 펜스를 다시 씌웁니다."""
    text = block["text"]
    if len(text) <= max_chars:
        return [block]

    def pieces(units: list[str], head: list[str] = (), tail: list[str] = ()) -> list[dict]:
        out, cur = [], []
        budget = max_chars - sum(len(u) + 1 for u in (*head, *tail))
        for u in units:
            if cur and sum(len(x) + 1 for x in cur) + len(u) > budget:
                out.append([*head, *cur, *tail])
                cur = []
            cur.append(u)
        if cur:
            out.append([*head, *cur, *tail])
        return [{**block, "text": "\n".join(p)} for p in out]

    lines = text.splitlines()
    if block["kind"] == "table":
        head = lines[:2] if len(lines) > 1 and _TABLE_SEP.match(lines[1]) else lines[:1]
        return pieces(lines[len(head) :], head=head)
    if block["kind"] == "code":
        return pieces(lines[1:-1], head=lines[:1], tail=lines[-1:])
    # 일반 문단: 줄 단위로 묶고, 한 줄이 너무 길면 기존 문장/단어 경계 규칙으로 자릅니다.
    units = []
    for line in lines:
        if len(line) <= max_chars:
            units.append(line)
        else:
            norm = collapse_ws(line)
            units += [norm[s:e].strip() for s, e in _chunk_spans(norm, max_chars, 0)]
    return pieces(units)


def _heading_label(title: str) -> str:
    # "● DIKW 피라미드", "- 데이터베이스 활용" 같은 장식 기호를 걷어 경로에 씁니다.
    title = re.sub(r"\*\*|__|`", "", title)
    return re.sub(r"^[\s\-–●○■□◆◇※☞▶·*]+", "", title).strip()


def chunk_markdown(md: str, max_chars: int = 800, min_chars: int = 200) -> list[dict]:
    """rag_markdown.md 를 제목 경계 기준으로 청킹합니다.

    - 제목이 바뀌면 새 청크를 시작합니다(직전 청크가 min_chars 보다 짧으면 다음 섹션과 합침).
    - 표·코드블록은 중간에서 자르지 않고, 너무 길면 행 단위로 나누며 표 머리 행을 반복합니다.
    - 청크 앞에 제목 경로("[1과목 > 데이터의 이해 > DIKW 피라미드]")를 붙여 임베딩 문맥을 보강합니다.
    반환: [{"content", "page", "pageStart", "pageEnd", "headingPath"}] (page 는 글자가 가장 많이 걸친 페이지)
    """
    stack: list[tuple[int, str]] = []
    chunks: list[dict] = []
    cur: list[dict] = []
    cur_path = ""

    def path() -> str:
        return " > ".join(t for _, t in stack[-3:] if t)

    def flush():
        nonlocal cur, cur_path
        # 끝에 매달린 제목은 다음 섹션의 시작이므로 다음 청크로 넘깁니다.
        carry = []
        while cur and cur[-1]["kind"] == "heading":
            carry.insert(0, cur.pop())
        body = [b for b in cur if b["kind"] != "heading"]
        if body:
            per_page: dict[int, int] = {}
            for b in cur:
                per_page[b["page"]] = per_page.get(b["page"], 0) + len(b["text"])
            text = "\n\n".join(b["text"] for b in cur)
            chunks.append(
                {
                    "content": f"[{cur_path}]\n{text}" if cur_path else text,
                    "page": max(per_page, key=lambda p: (per_page[p], -p)),
                    "pageStart": min(per_page),
                    "pageEnd": max(per_page),
                    "headingPath": cur_path,
                }
            )
            cur = []
        # 본문 없이 제목만 쌓인 경우는 다음 본문과 함께 내보냅니다.
        cur += carry
        if carry:
            cur_path = path()

    def size() -> int:
        return sum(len(b["text"]) + 2 for b in cur)

    def has_body() -> bool:
        return any(b["kind"] != "heading" for b in cur)

    for block in _md_blocks(md):
        if block["kind"] == "heading":
            if has_body() and size() >= min_chars:
                flush()
            while stack and stack[-1][0] >= block["level"]:
                stack.pop()
            stack.append((block["level"], _heading_label(block["title"])))
            if not cur:
                cur_path = path()
            cur.append(block)
            continue

        for piece in _split_block(block, max_chars):
            if has_body() and size() + len(piece["text"]) > max_chars:
                flush()
            if not cur:
                cur_path = path()
            cur.append(piece)
    flush()
    return chunks
