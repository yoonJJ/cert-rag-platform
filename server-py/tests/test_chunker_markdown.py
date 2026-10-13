from app.services.chunker import chunk_markdown

SAMPLE = """<!-- page: 1 -->

# 1과목 – 데이터 이해

![](_page_0_Picture_0.jpeg)

### ● DIKW 피라미드

- (1) 데이터 : 가공 전의 객관적인 사실
- (2) 정보 : 데이터를 통해 패턴 인식

<!-- page: 2 -->

### ● 분석 유형

| 대상\\방법 | Known | UnKnown |
| --- | --- | --- |
| Known | 최적화 | 통찰 |
| Un-Known | 솔루션 | 발견 |

<!-- page: 3 -->

# 2과목 – 데이터분석 기획

```text
> t.test(schoolA, schoolB)
t = -0.59758, df = 97.409, p-value = 0.5515
```
"""


def test_pages_and_heading_path():
    chunks = chunk_markdown(SAMPLE, max_chars=800, min_chars=0)
    assert [c["page"] for c in chunks] == [1, 2, 3]
    assert chunks[0]["headingPath"] == "1과목 – 데이터 이해"
    assert chunks[1]["headingPath"] == "1과목 – 데이터 이해 > 분석 유형"
    assert chunks[2]["headingPath"] == "2과목 – 데이터분석 기획"
    assert chunks[1]["content"].startswith("[1과목 – 데이터 이해 > 분석 유형]\n")
    # 이미지 자리표시는 버립니다.
    assert all("_page_0_Picture" not in c["content"] for c in chunks)


def test_small_sections_are_merged():
    chunks = chunk_markdown(SAMPLE, max_chars=800, min_chars=500)
    assert len(chunks) == 1
    assert chunks[0]["pageStart"] == 1 and chunks[0]["pageEnd"] == 3


def test_no_chunk_ends_with_heading():
    for min_chars in (0, 100, 500):
        for c in chunk_markdown(SAMPLE, max_chars=200, min_chars=min_chars):
            assert not c["content"].rstrip().splitlines()[-1].startswith("#")


def test_long_table_repeats_header_and_code_keeps_fence():
    rows = "\n".join(f"| 항목{i} | 설명 {'가' * 30} |" for i in range(40))
    code = "\n".join(f"line {i} " + "x" * 40 for i in range(40))
    md = f"<!-- page: 7 -->\n\n# 표\n\n| 이름 | 설명 |\n| --- | --- |\n{rows}\n\n# 코드\n\n```text\n{code}\n```\n"
    chunks = chunk_markdown(md, max_chars=500, min_chars=0)
    tables = [c for c in chunks if "항목" in c["content"]]
    codes = [c for c in chunks if "line " in c["content"]]
    assert len(tables) > 1 and len(codes) > 1
    for c in tables:
        assert "| 이름 | 설명 |\n| --- | --- |" in c["content"]
    for c in codes:
        body = c["content"].split("\n", 1)[1]  # 제목 경로 줄 제외
        assert body.count("```") == 2
    assert all(c["page"] == 7 for c in chunks)
    assert all(len(c["content"]) <= 560 for c in chunks)  # 경로 접두어만큼 여유
