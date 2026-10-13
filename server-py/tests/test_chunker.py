import random

from app.services.chunker import chunk_pages, chunk_text


def make_pages(seed: int, n_pages: int) -> list[str]:
    rng = random.Random(seed)
    words = ["정규화는", "중복을", "줄인다.", "TCP", "handshake", "SELECT", "\n", "  "]
    pages = []
    for _ in range(n_pages):
        # 빈 페이지·아주 짧은 페이지·긴 페이지를 섞습니다.
        size = rng.choice([0, 3, 40, 200, 600])
        pages.append(" ".join(rng.choice(words) for _ in range(size)))
    return pages


def test_same_chunks_as_chunk_text():
    for seed in range(30):
        pages = make_pages(seed, 12)
        assert [c["content"] for c in chunk_pages(pages)] == chunk_text("\n\n".join(pages))


def test_page_is_where_most_of_the_chunk_lives():
    # 페이지마다 고유한 표식 단어만 넣어 두면, 청크의 다수 단어가 곧 그 청크의 페이지입니다.
    pages = [" ".join([f"p{n}word"] * 150) for n in range(1, 8)]
    for c in chunk_pages(pages):
        words = c["content"].split()
        majority = max(set(words), key=words.count)
        assert c["page"] == int(majority[1:-4])
        assert c["pageStart"] <= c["page"] <= c["pageEnd"]


def test_empty_pages_keep_real_numbers():
    chunks = chunk_pages(["", "", "셋째 페이지 내용입니다.", "", "다섯째 페이지."])
    assert [c["page"] for c in chunks] == [3]
    assert chunks[0]["pageEnd"] == 5


def test_empty_document():
    assert chunk_pages([]) == []
    assert chunk_pages(["", "  \n "]) == []
