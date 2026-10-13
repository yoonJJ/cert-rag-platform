import json
import logging
import re
import unicodedata

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile as StarletteUploadFile

from app import db
from app.http import error
from app.services import documents
from app.services.chunker import chunk_markdown, chunk_pages, chunk_text
from app.services.llm import caption_image, create_chat_completion
from app.services.pdf import extract_pages, render_pdf_pages
from app.utils import clamp, collapse_ws, num_or

log = logging.getLogger(__name__)
router = APIRouter()

MAX_FILE_SIZE = 20 * 1024 * 1024
IMAGE_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def infer_exam_type(source) -> str:
    s = "".join(unicodedata.normalize("NFC", str(source or "")).lower().split())
    if "aws" in s or "saa" in s:
        return "AWS SAA"
    if "sqld" in s:
        return "SQLD"
    if "리눅스" in s or "linux" in s:
        return "리눅스마스터 2급"
    if "adsp" in s:
        return "ADsP"
    if "정보처리기사" in s or "기사" in s:
        return "정보처리기사"
    return ""


def parse_topic_array(raw) -> list[str]:
    text = str(raw or "").strip()
    code_block = re.sub(r"```json|```", "", text, flags=re.IGNORECASE).strip()
    arr_start = code_block.find("[")
    arr_end = code_block.rfind("]")
    candidate = code_block[arr_start : arr_end + 1] if arr_start != -1 and arr_end > arr_start else code_block
    parsed = json.loads(candidate)
    if not isinstance(parsed, list):
        raise ValueError("topics 응답이 배열이 아닙니다.")
    topics = [str(x if x is not None else "").strip() for x in parsed]
    return [t for t in topics if 2 <= len(t) <= 40][:12]


async def infer_topics_with_llm(source: str) -> list[str]:
    rows = await db.pool().fetch('SELECT content FROM "Chunk" WHERE source = $1 LIMIT 40', source)
    context = "\n\n".join(r["content"] for r in rows)[:12000]
    if not context.strip():
        return []

    prompt = f"""다음은 자격증 학습 PDF에서 추출한 텍스트입니다.
이 텍스트를 보고 학습 과목/토픽 이름만 5~12개 추려서 JSON 배열로만 출력하세요.
설명 문장 금지. 배열 외 텍스트 금지.

예시 출력:
["데이터베이스","운영체제","네트워크"]

[텍스트]
{context}"""

    raw = await create_chat_completion(messages=[{"role": "user", "content": prompt}], max_tokens=400)
    return parse_topic_array(raw or "[]")


async def _read_upload(request: Request, field: str) -> tuple[dict, StarletteUploadFile | None, bytes]:
    """multipart 폼을 읽어 (텍스트 필드, 파일, 파일 바이트)를 돌려줍니다."""
    form = await request.form()
    fields = {k: v for k, v in form.items() if isinstance(v, str)}
    file = form.get(field)
    if not isinstance(file, StarletteUploadFile):
        return fields, None, b""
    data = await file.read(MAX_FILE_SIZE + 1)
    return fields, file, data


def _source_name(fields: dict, file: StarletteUploadFile, fallback: str) -> str:
    # macOS 는 한글 파일명을 NFD(자모 분리)로 넘기기도 하므로 NFC 로 통일해 같은 파일이 같은 문서가 되게 합니다.
    return unicodedata.normalize("NFC", fields.get("sourceName") or file.filename or fallback)


@router.post("/upload")
async def upload_pdf(request: Request):
    try:
        fields, file, data = await _read_upload(request, "pdf")
        if not data:
            return error(400, "PDF 파일이 필요합니다.")
        if len(data) > MAX_FILE_SIZE:
            return error(413, "파일이 너무 큽니다. (최대 20MB)")

        source = _source_name(fields, file, "upload.pdf")
        want_images = str(fields.get("captionImages") or "").lower() in ("1", "true", "on", "yes")
        digest = documents.file_hash(data)

        # 같은 이름·같은 내용의 파일이 이미 있으면 임베딩 비용을 쓰지 않고 건너뜁니다.
        # (이미지 캡셔닝을 새로 요청한 경우는 다시 처리)
        existing = await documents.find_by_source(source)
        if existing and existing["fileHash"] == digest and (existing["imageCaptioned"] or not want_images):
            return {
                "ok": True,
                "source": source,
                "chunkCount": existing["chunkCount"],
                "pageCount": existing["pageCount"],
                "imagePagesCaptioned": 0,
                "imageChunkCount": 0,
                "skipped": True,
                "replaced": False,
            }

        page_texts = await run_in_threadpool(extract_pages, data)
        text_chunks = chunk_pages(page_texts)
        chunks = await documents.embed_chunks(text_chunks)

        # (옵션) PDF 페이지를 이미지로 렌더링해 비전 모델로 캡셔닝 → 도표/다이어그램/스캔본도 임베딩.
        # 페이지당 비전 호출이 발생하므로 클라이언트에서 명시적으로 켤 때만 수행합니다.
        # 실패해도 텍스트 업로드 자체는 성공 처리합니다.
        image_chunk_count = 0
        image_pages_captioned = 0
        image_note = ""
        if want_images:
            try:
                rendered = await run_in_threadpool(render_pdf_pages, data)
                pages, total_pages = rendered["pages"], rendered["totalPages"]
                for pg in pages:
                    try:
                        caption = await caption_image(
                            pg["png"],
                            "image/png",
                            f'"{source}" 문서의 {pg["pageNumber"]}페이지(전체 {total_pages}p)입니다.',
                        )
                        if not caption:
                            continue
                        image_chunks = [
                            {"content": f"[p.{pg['pageNumber']} 페이지 이미지 설명]\n{c}", "page": pg["pageNumber"]}
                            for c in chunk_text(caption)
                        ]
                        chunks += await documents.embed_chunks(image_chunks)
                        image_chunk_count += len(image_chunks)
                        image_pages_captioned += 1
                    except Exception as cap_err:  # noqa: BLE001
                        log.error("이미지 캡셔닝 실패 (p.%s): %s", pg["pageNumber"], cap_err)
                if rendered["truncated"]:
                    image_note = f"이미지 캡셔닝은 상한({len(pages)}p)까지만 처리했습니다. (전체 {total_pages}p)"
            except Exception as img_err:  # noqa: BLE001
                log.error("PDF 이미지 렌더링 실패: %s", img_err)
                image_note = "이미지 캡셔닝 중 오류가 발생해 텍스트만 저장했습니다."

        saved = await documents.replace_document(
            source=source,
            file_hash=digest,
            mime_type="application/pdf",
            page_count=len(page_texts),
            chunks=chunks,
            image_captioned=image_pages_captioned > 0,
        )

        body = {
            "ok": True,
            "source": source,
            "chunkCount": len(text_chunks),
            "pageCount": len(page_texts),
            "imagePagesCaptioned": image_pages_captioned,
            "imageChunkCount": image_chunk_count,
            "skipped": False,
            "replaced": saved["replaced"],
        }
        if image_note:
            body["imageNote"] = image_note
        return body
    except Exception as e:  # noqa: BLE001
        log.exception("업로드 실패")
        return error(500, str(e) or "업로드 실패")


# 오프라인 변환(scripts/ingest.py)으로 만든 rag_markdown.md 업로드.
# <!-- page: N --> 표시로 실제 페이지를 유지하고, 제목·표·코드블록 구조 기준으로 청킹합니다.
@router.post("/upload-markdown")
async def upload_markdown(request: Request):
    try:
        fields, file, data = await _read_upload(request, "markdown")
        if not data:
            return error(400, "마크다운 파일이 필요합니다.")
        if len(data) > MAX_FILE_SIZE:
            return error(413, "파일이 너무 큽니다. (최대 20MB)")
        try:
            md = data.decode("utf-8")
        except UnicodeDecodeError:
            return error(400, "UTF-8 마크다운 파일이 아닙니다.")

        # 보통 원본 PDF 이름(sourceName)으로 올려 PDF 업로드 문서를 그대로 교체합니다.
        source = _source_name(fields, file, "document.md")
        digest = documents.file_hash(data)
        existing = await documents.find_by_source(source)
        if existing and existing["fileHash"] == digest:
            return {
                "ok": True,
                "source": source,
                "chunkCount": existing["chunkCount"],
                "pageCount": existing["pageCount"],
                "skipped": True,
                "replaced": False,
            }

        text_chunks = chunk_markdown(md)
        if not text_chunks:
            return error(400, "마크다운에서 본문을 찾지 못했습니다.")
        page_marks = [int(n) for n in re.findall(r"^<!--\s*page:\s*(\d+)\s*-->", md, re.M)]
        page_count = max(page_marks) if page_marks else None

        chunks = await documents.embed_chunks(text_chunks)
        saved = await documents.replace_document(
            source=source,
            file_hash=digest,
            mime_type="text/markdown",
            page_count=page_count,
            chunks=chunks,
            image_captioned=False,
        )
        return {
            "ok": True,
            "source": source,
            "chunkCount": len(text_chunks),
            "pageCount": page_count,
            "skipped": False,
            "replaced": saved["replaced"],
        }
    except Exception as e:  # noqa: BLE001
        log.exception("마크다운 업로드 실패")
        return error(500, str(e) or "마크다운 업로드 실패")


# 이미지 업로드: 비전 모델로 캡셔닝 → 설명 텍스트를 기존 청크/임베딩 파이프라인에 합류.
# 이미지 1장 = 1페이지 문서로 저장합니다.
@router.post("/upload-image")
async def upload_image(request: Request):
    try:
        fields, file, data = await _read_upload(request, "image")
        if not data:
            return error(400, "이미지 파일이 필요합니다.")
        if len(data) > MAX_FILE_SIZE:
            return error(413, "파일이 너무 큽니다. (최대 20MB)")
        mime = file.content_type or ""
        if mime not in IMAGE_MIME:
            return error(400, "지원하지 않는 이미지 형식입니다. (png/jpg/webp/gif)")

        source = _source_name(fields, file, "image-upload")
        hint = str(fields.get("hint") or "").strip()

        caption = await caption_image(data, mime, hint)
        if not caption:
            return error(422, "이미지에서 설명을 추출하지 못했습니다.")

        chunks = await documents.embed_chunks([{"content": c, "page": 1} for c in chunk_text(caption)])
        saved = await documents.replace_document(
            source=source,
            file_hash=documents.file_hash(data),
            mime_type=mime,
            page_count=1,
            chunks=chunks,
            image_captioned=True,
        )

        return {
            "ok": True,
            "source": source,
            "chunkCount": len(chunks),
            "captionPreview": caption[:280],
            "replaced": saved["replaced"],
        }
    except Exception as e:  # noqa: BLE001
        log.exception("이미지 업로드 실패")
        return error(500, str(e) or "이미지 업로드 실패")


@router.get("/sources")
async def list_sources():
    try:
        rows = await db.pool().fetch('SELECT DISTINCT source FROM "Chunk" ORDER BY source')
        sources = [r["source"] for r in rows if r["source"]]

        source_exam_type = {s: infer_exam_type(s) for s in sources}
        exam_type_options = list(dict.fromkeys(v for v in source_exam_type.values() if v))
        if sources and not exam_type_options:
            exam_type_options.append("기타")

        return {"sources": sources, "examTypeOptions": exam_type_options, "sourceExamType": source_exam_type}
    except Exception as e:  # noqa: BLE001
        log.exception("sources 조회 실패")
        return error(500, str(e) or "sources 조회 실패")


@router.get("/sources/stats")
async def source_stats():
    try:
        rows = await db.pool().fetch(
            """SELECT d.source, d."pageCount", d."pageAccurate", d."createdAt",
                      COUNT(c.id) AS count, MAX(c.page) AS max_page
                 FROM "Document" d
                 LEFT JOIN "Chunk" c ON c."documentId" = d.id
                GROUP BY d.id
                ORDER BY d.source ASC"""
        )
        files = [
            {
                "source": r["source"],
                "chunkCount": r["count"] or 0,
                "maxPage": r["max_page"] or 0,
                "pageCount": r["pageCount"],
                # false 면 이전 서버가 청크 순번을 페이지로 저장한 문서입니다. 다시 올리면 실제 페이지로 바뀝니다.
                "pageAccurate": r["pageAccurate"],
                "examType": infer_exam_type(r["source"]) or "기타",
            }
            for r in rows
        ]
        return {"files": files, "totalFiles": len(files)}
    except Exception as e:  # noqa: BLE001
        log.exception("sources stats 조회 실패")
        return error(500, str(e) or "sources stats 조회 실패")


@router.delete("/sources")
async def delete_source(source: str = ""):
    try:
        source = source.strip()
        if not source:
            return error(400, "source 파라미터가 필요합니다.")
        found, deleted = await documents.delete_by_source(source)
        if not found:
            return error(404, "해당 문서가 없습니다.")
        return {"ok": True, "source": source, "deletedChunks": deleted}
    except Exception as e:  # noqa: BLE001
        log.exception("문서 삭제 실패")
        return error(500, str(e) or "문서 삭제 실패")


@router.get("/sources/topics")
async def source_topics(source: str = ""):
    try:
        source = source.strip()
        if not source:
            return error(400, "source 파라미터가 필요합니다.")
        topics = await infer_topics_with_llm(source)
        return {"source": source, "topics": topics}
    except Exception as e:  # noqa: BLE001
        log.exception("topics 추출 실패")
        return error(500, str(e) or "topics 추출 실패")


@router.get("/sources/metadata")
async def source_metadata(source: str = "", limit: str = ""):
    try:
        source = source.strip()
        take = int(clamp(num_or(limit, 5), 1, 20))
        if not source:
            return error(400, "source 파라미터가 필요합니다.")

        agg = await db.pool().fetchrow(
            'SELECT COUNT(*) AS count, MIN(page) AS min_page, MAX(page) AS max_page FROM "Chunk" WHERE source = $1',
            source,
        )
        samples = await db.pool().fetch(
            'SELECT id, page, content FROM "Chunk" WHERE source = $1 ORDER BY page ASC LIMIT $2', source, take
        )

        return {
            "source": source,
            "chunkCount": agg["count"] or 0,
            "minPage": agg["min_page"] or 0,
            "maxPage": agg["max_page"] or 0,
            "sampleChunks": [
                {"id": r["id"], "page": r["page"], "preview": collapse_ws(r["content"])[:180]} for r in samples
            ],
        }
    except Exception as e:  # noqa: BLE001
        log.exception("metadata 조회 실패")
        return error(500, str(e) or "metadata 조회 실패")


@router.get("/sources/chunks")
async def source_chunks(source: str = "", limit: str = "", offset: str = "", q: str = ""):
    try:
        source = source.strip()
        q = q.strip()
        take = int(clamp(num_or(limit, 30), 1, 100))
        skip = int(max(num_or(offset, 0), 0))
        if not source:
            return error(400, "source 파라미터가 필요합니다.")

        # idx 는 검색어와 무관하게 문서 안에서의 순번(1부터)입니다.
        rows = await db.pool().fetch(
            """SELECT * FROM (
                   SELECT id, page, content, ROW_NUMBER() OVER (ORDER BY page ASC, id ASC) AS idx
                     FROM "Chunk" WHERE source = $1
               ) c
              WHERE $2 = '' OR strpos(lower(content), lower($2)) > 0
              ORDER BY idx
              LIMIT $3 OFFSET $4""",
            source,
            q,
            take,
            skip,
        )
        total = await db.pool().fetchval(
            """SELECT COUNT(*) FROM "Chunk"
                WHERE source = $1 AND ($2 = '' OR strpos(lower(content), lower($2)) > 0)""",
            source,
            q,
        )
        doc = await db.pool().fetchrow(
            """SELECT d."pageCount", d."chunkCount", d."imageCaptioned", d."pageAccurate", d."mimeType",
                      (SELECT MAX(page) FROM "Chunk" WHERE source = d.source) AS "maxPage"
                 FROM "Document" d WHERE d.source = $1""",
            source,
        )

        return {
            "source": source,
            "total": total,
            "limit": take,
            "offset": skip,
            "q": q,
            "document": dict(doc) if doc else None,
            "chunks": [
                {
                    "id": r["id"],
                    "index": r["idx"],
                    "page": r["page"],
                    "length": len(r["content"]),
                    "content": r["content"],
                    "preview": collapse_ws(r["content"])[:260],
                }
                for r in rows
            ],
        }
    except Exception as e:  # noqa: BLE001
        log.exception("chunks 조회 실패")
        return error(500, str(e) or "chunks 조회 실패")
