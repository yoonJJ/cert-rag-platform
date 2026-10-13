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
