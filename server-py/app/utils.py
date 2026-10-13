"""Express 서버(JS)와 동일한 동작을 위한 공통 헬퍼."""

import math
import re
import secrets
import string
import time
from datetime import datetime, timezone

# JS 의 \s 는 BOM(﻿) 도 공백으로 취급하므로 맞춰줍니다.
_WS = re.compile(r"[\s﻿]+")
_B36 = string.digits + string.ascii_lowercase


def js_number(value) -> float:
    """JS Number() 와 같은 규칙으로 숫자 변환합니다. 변환 불가 시 NaN."""
    if value is None:
        return math.nan
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return math.nan


def num_or(value, default: float) -> float:
    """JS 의 `Number(x) || default` 패턴 (0/NaN 이면 default)."""
    n = js_number(value)
    return default if (math.isnan(n) or n == 0) else n


def clamp(n: float, lo: float, hi: float) -> float:
    return min(max(n, lo), hi)


def fmt_num(n: float) -> str:
    """템플릿 문자열에 숫자를 넣을 때 JS 와 같은 표기 (5.0 → '5')."""
    if math.isnan(n):
        return "NaN"
    return str(int(n)) if float(n).is_integer() else str(n)


def normalize_answer_index(answer, options) -> int:
    size = len(options) if isinstance(options, list) else 0
    n = js_number(answer)
    if not math.isfinite(n):
        return 0
    if size > 0 and 0 <= n < size:
        return int(n)
    if size > 0 and 1 <= n <= size:
        return int(n - 1)
    return int(max(0, n))


def collapse_ws(text) -> str:
    return _WS.sub(" ", str(text or "")).strip()


def new_cuid() -> str:
    """Prisma @default(cuid()) 와 비슷한 형태(c + 24자 base36)의 ID."""
    ts = int(time.time() * 1000)
    head = ""
    while ts:
        ts, r = divmod(ts, 36)
        head = _B36[r] + head
    rand = "".join(secrets.choice(_B36) for _ in range(24 - len(head)))
    return f"c{head}{rand}"


def utcnow() -> datetime:
    """Prisma 와 같이 TIMESTAMP(3) 컬럼에는 UTC naive datetime 을 저장합니다."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def iso(dt: datetime | None) -> str | None:
    """Prisma JSON 직렬화와 같은 형식: 2026-01-02T03:04:05.678Z"""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
