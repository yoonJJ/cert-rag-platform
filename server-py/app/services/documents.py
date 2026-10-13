"""문서(Document) 단위 저장·교체·삭제."""

import hashlib
import uuid

from app import db
from app.services.rag import embed, vector_literal
from app.utils import new_cuid, utcnow


def file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def find_by_source(source: str):
    return await db.pool().fetchrow('SELECT * FROM "Document" WHERE source = $1', source)


async def embed_chunks(chunks: list[dict]) -> list[dict]:
    """[{"content", "page"}] 에 임베딩을 붙여 돌려줍니다. DB 에는 아직 쓰지 않습니다."""
    out = []
    for c in chunks:
        out.append({**c, "vector": vector_literal(await embed(c["content"]))})
    return out


async def replace_document(
    *,
    source: str,
    file_hash: str,
    mime_type: str,
    page_count: int | None,
    chunks: list[dict],
    image_captioned: bool,
) -> dict:
    """같은 source 의 기존 문서를 지우고 새 문서·청크로 교체합니다 (한 트랜잭션).

    임베딩은 호출 전에 끝나 있어야 합니다. 그래야 중간에 실패해도 기존 데이터가 그대로 남습니다.
    반환: {"documentId", "replaced"}
    """
    document_id = new_cuid()
    async with db.pool().acquire() as conn, conn.transaction():
        deleted = await conn.fetchval('DELETE FROM "Document" WHERE source = $1 RETURNING id', source)
        # 문서에 묶이지 않은 같은 이름의 청크(이전 서버가 쓴 데이터)도 함께 정리합니다.
        await conn.execute('DELETE FROM "Chunk" WHERE source = $1 AND "documentId" IS NULL', source)
        await conn.execute(
            """INSERT INTO "Document"
                 (id, source, "fileHash", "mimeType", "pageCount", "chunkCount", "imageCaptioned", "pageAccurate", "createdAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)""",
            document_id,
            source,
            file_hash,
            mime_type,
            page_count,
            len(chunks),
            image_captioned,
            utcnow(),
        )
        await conn.executemany(
            """INSERT INTO "Chunk" (id, content, embedding, source, page, "documentId")
               VALUES ($1, $2, $3::text::vector, $4, $5, $6)""",
            [(str(uuid.uuid4()), c["content"], c["vector"], source, int(c["page"]), document_id) for c in chunks],
        )
    return {"documentId": document_id, "replaced": deleted is not None}


async def delete_by_source(source: str) -> tuple[bool, int]:
    """문서와 청크를 삭제합니다. 반환: (문서/청크가 있었는지, 지운 청크 수)"""
    async with db.pool().acquire() as conn, conn.transaction():
        count = await conn.fetchval('SELECT COUNT(*) FROM "Chunk" WHERE source = $1', source)
        doc_id = await conn.fetchval('DELETE FROM "Document" WHERE source = $1 RETURNING id', source)
        await conn.execute('DELETE FROM "Chunk" WHERE source = $1', source)
    return (doc_id is not None or count > 0), count
