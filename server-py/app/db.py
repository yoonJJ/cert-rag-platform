import json
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import asyncpg

_pool: asyncpg.Pool | None = None

SCHEMA_SQL = Path(__file__).with_name("schema.sql")


def _database_url() -> str:
    """Prisma 전용 쿼리 파라미터(?schema=public 등)는 asyncpg 가 모르므로 제거합니다."""
    url = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/certdb")
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in ("schema", "connection_limit", "pool_timeout")]
    return urlunsplit(parts._replace(query=urlencode(query)))


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Prisma 의 Json 컬럼(JSONB)을 파이썬 객체로 주고받습니다.
    for typename in ("jsonb", "json"):
        await conn.set_type_codec(
            typename,
            encoder=lambda v: json.dumps(v, ensure_ascii=False),
            decoder=json.loads,
            schema="pg_catalog",
        )


async def connect() -> None:
    global _pool
    _pool = await asyncpg.create_pool(_database_url(), min_size=1, max_size=10, init=_init_connection)


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool is not initialized")
    return _pool


async def ensure_schema() -> None:
    """pgvector 확장과 테이블을 준비합니다. 기존(Prisma 가 만든) 테이블이 있으면 그대로 둡니다."""
    async with pool().acquire() as conn:
        await conn.execute(SCHEMA_SQL.read_text(encoding="utf-8"))
