# 시험 플랫폼 - API 서버 (FastAPI)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐시)
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

ENV PORT=3001
EXPOSE 3001

# 테이블/pgvector 확장은 기동 시 app/schema.sql 로 준비됩니다 (기존 테이블은 그대로 유지).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
