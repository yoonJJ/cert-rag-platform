"""PDF → rag_markdown.md 오프라인 변환 스크립트 (로컬에서 문서당 한 번 실행).

1) Marker 로 레이아웃·표·제목 구조를 살린 페이지별 마크다운을 만들고
2) PyMuPDF 로 문제 있는 페이지(깨진 글자, 큰 이미지, 표)를 골라
3) 그 페이지만 Gemini 에 [페이지 이미지 + 초안 마크다운]을 보내 교정하고
4) 교정 결과가 초안과 너무 다르면(지어냈을 가능성) 버리고 초안을 유지합니다.

서버 의존성과 분리된 별도 venv 에서 실행합니다:
    uv venv .venv-ingest && uv pip install -p .venv-ingest/bin/python -r scripts/requirements-ingest.txt
    GOOGLE_API_KEY=... .venv-ingest/bin/python scripts/ingest.py file.pdf -o out/ [--upload http://localhost:3001]

Marker 결과는 파일 해시로 캐시하므로, 교정 단계만 바꿔 다시 돌릴 때는 Marker 를 건너뜁니다.
"""

import argparse
import asyncio
import difflib
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import pymupdf

PAGE_SPLIT = re.compile(r"\n*\{(\d+)\}-{48}\n*")
DEFAULT_MODEL = "gemini-3.5-flash-lite"

CORRECT_PROMPT = """아래 이미지는 PDF 한 페이지이고, [초안]은 이 페이지를 자동 추출한 마크다운입니다.
이미지를 기준으로 초안을 교정한 마크다운만 출력하세요.

규칙:
- 이미지에 있는 내용만 쓰세요. 요약·해설·새 내용 추가 금지.
- 초안에서 #으로 시작하는 제목 줄은 # 개수까지 그대로 두세요(# 를 지우거나 ● 목록으로 바꾸지 마세요).
- 순서는 유지하고, 틀리거나 빠진 글자·숫자·기호만 고치세요.
- 깨지거나 누락된 지수·수식은 LaTeX 로 쓰세요. 예: $2^{{50}}$, $\\frac{{a}}{{b}}$
- 부등호 등 일반 기호는 그대로(<, >) 쓰고 \\langle 같은 기호로 바꾸지 마세요.
- 이미지 속 표는 마크다운 표(| a | b |)로 쓰세요. \\begin{{tabular}} 같은 LaTeX 표 환경은 쓰지 마세요.
- 프로그램 실행 결과·코드 화면은 ```text 코드블록 안에 화면 그대로(줄바꿈·숫자 포함) 옮기세요.
- 숫자는 자릿수까지 이미지와 정확히 같게 쓰세요. 원문의 오탈자도 고치지 말고 그대로 두세요.
- 표가 아닌 도식은 목록으로 옮기세요.
- 머리글·바닥글의 쪽 번호, 반복되는 로고 문구는 빼세요.
- 답변 전체를 코드펜스로 감싸지 말고 마크다운 본문만 출력하세요.

[초안]
{draft}"""


def log(msg: str) -> None:
    print(msg, flush=True)


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------- 1) Marker ----------

def run_marker(pdf: Path, cache_dir: Path) -> dict[int, str]:
    """페이지 번호(1부터) → 마크다운. 결과는 파일 해시로 캐시합니다."""
    cache = cache_dir / f"marker_{file_hash(pdf)[:16]}.json"
    if cache.exists():
        log(f"[marker] 캐시 사용: {cache.name}")
        return {int(k): v for k, v in json.loads(cache.read_text()).items()}

    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered

    t = time.time()
    log("[marker] 모델 불러오는 중…")
    converter = PdfConverter(
        artifact_dict=create_model_dict(),
        config={"paginate_output": True, "disable_image_extraction": True, "output_format": "markdown"},
    )
    log("[marker] 변환 중…")
    text, _, _ = text_from_rendered(converter(str(pdf)))

    parts = PAGE_SPLIT.split(text)  # ["", "0", page0, "1", page1, ...]
    pages = {int(parts[i]) + 1: parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}
    cache.write_text(json.dumps(pages, ensure_ascii=False))
    log(f"[marker] {len(pages)}쪽 완료 ({time.time() - t:.0f}초)")
    return pages


# ---------- 2) 문제 페이지 판별 ----------

def page_signals(doc: pymupdf.Document, number: int, draft: str) -> dict:
    page = doc[number - 1]
    text = page.get_text()
    garbled = sum(1 for c in text if unicodedata.category(c) in ("Co", "Cn") or c == "�")

    area = page.rect.width * page.rect.height
    image_area = 0.0
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & page.rect
        image_area += r.width * r.height

    reasons = []
    if garbled:
        reasons.append(f"깨진 글자 {garbled}")
    if image_area / area >= 0.15:
        reasons.append(f"이미지 {image_area / area:.0%}")
    if re.search(r"^\|", draft, re.M):
        reasons.append("표")
    return {"garbled": garbled, "imageRatio": round(image_area / area, 3), "reasons": reasons}


def render_png(doc: pymupdf.Document, number: int, scale: float = 2.0) -> bytes:
    return doc[number - 1].get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).tobytes("png")


# ---------- 3) Gemini 교정 ----------

def _plain(md: str) -> str:
    """비교용: 마크다운 기호·공백·LaTeX 명령을 걷어낸 글자열."""
    md = re.sub(r"\\[a-zA-Z]+|<[^>]+>|[#*|`$\\{}^_\-:>]", "", md)
    return re.sub(r"\s+", "", md)


def restore_headings(draft: str, fixed: str) -> str:
    """교정 결과에서 # 가 빠진 제목 줄을 초안 기준으로 되살립니다(청킹이 제목 경계에 의존하므로)."""
    headings = {}
    for line in draft.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*\S)", line)
        if m:
            headings.setdefault(_plain(m.group(2)), m.group(1))
    out = []
    for line in fixed.splitlines():
        key = _plain(line)
        if key and not line.lstrip().startswith("#") and key in headings:
            line = f"{headings[key]} {line.strip()}"
        out.append(line)
    return "\n".join(out)


def preserved(draft: str, fixed: str) -> float:
    """초안 글자 중 교정 결과에 남아 있는 비율. 이미지에서 읽어 덧붙인 내용은 감점하지 않고,
    초안 내용을 지우거나 바꿔 쓴 경우(지어냈을 가능성)만 낮아집니다."""
    a, b = _plain(draft), _plain(fixed)
    if not a:
        return 1.0
    matched = sum(m.size for m in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks())
    return matched / len(a)


def cleanup(md: str) -> str:
    # OCR 이 부등호를 꺾쇠 기호로 읽는 경우가 있어, 단독으로 쓰인 것만 되돌립니다.
    return md.replace("$\\langle$", "<").replace("$\\rangle$", ">")


async def correct_page(client, model: str, png: bytes, draft: str, sem: asyncio.Semaphore, timeout: float) -> dict:
    from google.genai import errors, types

    async with sem:
        for attempt in range(6):
            t = time.time()
            try:
                res = await asyncio.wait_for(
                    client.aio.models.generate_content(
                        model=model,
                        contents=[
                            types.Part.from_bytes(data=png, mime_type="image/png"),
                            CORRECT_PROMPT.format(draft=draft or "(비어 있음)"),
                        ],
                        config={"temperature": 0},
                    ),
                    timeout,
                )
                text = re.sub(r"^```(?:markdown)?\s*|\s*```$", "", (res.text or "").strip())
                u = res.usage_metadata
                return {
                    "text": text,
                    "seconds": round(time.time() - t, 1),
                    "inputTokens": u.prompt_token_count or 0,
                    "outputTokens": (u.candidates_token_count or 0) + (u.thoughts_token_count or 0),
                }
            except (asyncio.TimeoutError, errors.APIError) as e:
                code = getattr(e, "code", "timeout")
                if code not in ("timeout", 429, 500, 503, 504) or attempt == 5:
                    return {"error": f"{code}: {str(e)[:200]}"}
                # 무료 등급은 분당 요청 한도(429)가 빡빡합니다. 서버가 알려준 대기 시간을 따릅니다.
                m = re.search(r"retryDelay['\"]?:\s*['\"](\d+(?:\.\d+)?)s", str(e))
                await asyncio.sleep(float(m.group(1)) + 1 if m else (15 if code == 429 else 2) * (attempt + 1))
    return {"error": "unreachable"}


def upload(server: str, md_path: Path, source: str) -> None:
    import httpx

    url = server.rstrip("/") + "/api/upload-markdown"
    log(f"[업로드] {url} ← {source} (임베딩 중…)")
    with md_path.open("rb") as f:
        res = httpx.post(
            url,
            files={"markdown": (md_path.name, f, "text/markdown")},
            data={"sourceName": unicodedata.normalize("NFC", source)},
            timeout=600,
        )
    body = res.json()
    if res.status_code >= 400 or not body.get("ok"):
        sys.exit(f"[업로드] 실패: {body.get('error') or res.status_code}")
    state = "건너뜀(같은 파일)" if body.get("skipped") else ("교체" if body.get("replaced") else "새 문서")
    log(f"[업로드] {state}: 청크 {body['chunkCount']}개, {body['pageCount']}쪽")


# ---------- 4) 조립 ----------

async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("ingest_out"))
    ap.add_argument("--model", default=os.getenv("INGEST_MODEL") or DEFAULT_MODEL)
    ap.add_argument("--all-pages", action="store_true", help="문제 페이지만이 아니라 전 페이지 교정")
    ap.add_argument("--no-llm", action="store_true", help="Marker 결과만 사용")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--upload", metavar="SERVER_URL", help="완료 후 서버(/api/upload-markdown)에 원본 PDF 이름으로 업로드")
    ap.add_argument("--timeout", type=float, default=90)
    ap.add_argument("--min-preserved", type=float, default=0.6, help="초안 글자가 이 비율보다 적게 남으면 교정 결과를 버림")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    drafts = run_marker(args.pdf, args.out)
    doc = pymupdf.open(args.pdf)

    pages = []
    for n in range(1, doc.page_count + 1):
        draft = drafts.get(n, "")
        pages.append({"page": n, "draft": draft, **page_signals(doc, n, draft)})
    targets = [p for p in pages if args.all_pages or p["reasons"]]
    log(f"[판별] {doc.page_count}쪽 중 교정 대상 {len(targets)}쪽")

    # 성공한 교정 결과는 (파일, 모델, 프롬프트, 초안) 기준으로 캐시해 재실행 시 실패한 페이지만 다시 요청합니다.
    llm_cache_path = args.out / f"llm_{file_hash(args.pdf)[:16]}_{args.model}.json"
    llm_cache = json.loads(llm_cache_path.read_text()) if llm_cache_path.exists() else {}

    def cache_key(p: dict) -> str:
        return hashlib.sha256((CORRECT_PROMPT + p["draft"]).encode()).hexdigest()[:16]

    for p in targets:
        hit = llm_cache.get(str(p["page"]))
        if hit and hit.get("key") == cache_key(p):
            p["llm"] = hit["result"]
    pending = [p for p in targets if "llm" not in p]
    if len(pending) < len(targets):
        log(f"[교정] 캐시 {len(targets) - len(pending)}쪽 재사용, 새로 요청 {len(pending)}쪽")

    if not args.no_llm and pending:
        from google import genai

        if not os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
            sys.exit("GOOGLE_API_KEY(또는 GEMINI_API_KEY) 환경변수가 필요합니다.")
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
        sem = asyncio.Semaphore(args.concurrency)
        t = time.time()
        done = 0

        async def run(p: dict) -> None:
            nonlocal done
            p["llm"] = await correct_page(client, args.model, render_png(doc, p["page"]), p["draft"], sem, args.timeout)
            done += 1
            r = p["llm"]
            if "text" in r:
                llm_cache[str(p["page"])] = {"key": cache_key(p), "result": r}
                llm_cache_path.write_text(json.dumps(llm_cache, ensure_ascii=False))
            status = f"오류 {r['error'][:60]}" if "error" in r else f"{r['seconds']}초"
            log(f"[교정] {done}/{len(pending)}  p.{p['page']:<3} {', '.join(p['reasons']) or '-':24} {status}")

        await asyncio.gather(*(run(p) for p in pending))
        log(f"[교정] 완료 ({time.time() - t:.0f}초, {args.model})")

    out_lines, in_tok, out_tok = [], 0, 0
    for p in pages:
        final, decision = p["draft"], "draft"
        r = p.get("llm")
        if r and "text" in r:
            in_tok += r["inputTokens"]
            out_tok += r["outputTokens"]
            p["preserved"] = round(preserved(p["draft"], r["text"]), 3)
            if p["preserved"] >= args.min_preserved:
                final, decision = restore_headings(p["draft"], r["text"]), "corrected"
            else:
                decision = "rejected"
        elif r:
            decision = "error"
        p["decision"] = decision
        p["final"] = final
        p["final"] = final = cleanup(final)
        out_lines.append(f"<!-- page: {p['page']} -->\n\n{final.strip()}\n")

    md_path = args.out / "rag_markdown.md"
    md_path.write_text("\n".join(out_lines))
    report = {
        "source": args.pdf.name,
        "fileHash": file_hash(args.pdf),
        "model": None if args.no_llm else args.model,
        "pageCount": doc.page_count,
        "seconds": round(time.time() - started, 1),
        "inputTokens": in_tok,
        "outputTokens": out_tok,
        "pages": [{k: v for k, v in p.items() if k not in ("draft", "final")} | {"llm": None} for p in pages],
    }
    for rp, p in zip(report["pages"], pages):
        if p.get("llm"):
            rp["llm"] = {k: v for k, v in p["llm"].items() if k != "text"}
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))

    if args.upload:
        upload(args.upload, md_path, args.pdf.name)

    counts = {d: sum(1 for p in pages if p["decision"] == d) for d in ("corrected", "rejected", "error", "draft")}
    log(
        f"[완료] {md_path}  교정 {counts['corrected']} · 거부 {counts['rejected']} · 오류 {counts['error']} · 초안 유지 {counts['draft']}"
        f"  | 토큰 입력 {in_tok:,} / 출력 {out_tok:,}  | 총 {report['seconds']:.0f}초"
    )


if __name__ == "__main__":
    asyncio.run(main())
