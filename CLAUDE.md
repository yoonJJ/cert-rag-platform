# cert-rag-platform

IT 자격증 PDF를 청크·임베딩·벡터 검색으로 묶어 객관식 문제를 만드는 RAG 학습 플랫폼 (포트폴리오 프로젝트).

## 구조
- `server-py/` — **실제 백엔드** (FastAPI + asyncpg + Postgres/pgvector). ORM 없이 Raw SQL.
  - 스키마 기준은 `server-py/app/schema.sql` (서버 시작 시 멱등 실행). 스키마 변경은 여기에 `IF NOT EXISTS`/DO 블록으로 추가.
  - `scripts/ingest.py` — PDF → `rag_markdown.md` 오프라인 변환(Marker + Gemini 교정). 서버와 별도 venv(`scripts/requirements-ingest.txt`).
- `server/` — 이전 Express + Prisma 서버. **참고용**이며 수정하지 않음. 단, `server/eval/`(검색 품질 평가)은 현역.
- `client/` — React + Vite + Tailwind. 페이지는 `client/src/pages/`, 메뉴는 `client/src/App.jsx`의 `navGroups`(학습 / 지식베이스).

## 실행·검증
- 서버: `cd server-py && .venv/bin/uvicorn app.main:app --reload --port 3001` (Swagger: `/docs`)
  - `--reload`는 `.py`만 감시. `.env`를 바꾸면 재시작 필요.
- 클라이언트: `cd client && npm run dev` (5173)
- 테스트: `cd server-py && .venv/bin/pytest -q`
- 클라이언트 빌드 확인: `cd client && npx vite build --outDir <임시 폴더>` (eslint 없음, `dist/`를 더럽히지 않기)
- 검색 평가: `cd server && RUN_TAG=<이름> node eval/retrieval_eval.js` — 골드셋은 실제 PDF 페이지 기준

## 규칙
- 커밋 메시지는 **한글**로 작성.
- `main`에 직접 push하지 않음 → 브랜치 + PR, 리뷰어 `jinho-yoo-jack`. (`/pr` 스킬 사용)
- `.env*`는 절대 커밋하지 않음. API 키 값은 출력·로그에 남기지 않음(이름만 확인).
- **비용**: 유료 API는 기본으로 쓰지 않음. LLM·임베딩은 Gemini 무료 등급 우선(`GEMINI_API_KEY`, `server-py/.env`). 사용자에게 유료 키 추가를 먼저 권하지 않기.
- UI 문구는 한국어. 기존 API 응답 형식은 유지(필드 추가는 가능, 제거·변경은 클라이언트 확인 후).
- 질문에는 먼저 말로 답하고, 필요할 때만 도구로 확인.

## 도메인 메모
- 문서 단위 관리: `Document`(source UNIQUE) 1 : N `Chunk`(ON DELETE CASCADE). 같은 이름 재업로드 = 교체, 같은 파일 해시 = 건너뜀.
- `Chunk.page`는 실제 PDF 페이지. `Document.pageAccurate=false`는 예전 서버가 청크 순번을 page로 저장한 레거시 문서.
- 파일명은 NFC로 정규화(macOS가 한글을 NFD로 보냄).
- 임베딩 차원 768 고정(`vector(768)`). 임베딩 모델을 바꾸면 기존 벡터와 섞어 쓸 수 없으니 문서를 다시 올려야 함.

## 배포
- 내부 서버 192.168.20.92 `/data/AIProject`, Docker(`docker-compose.prod.yml`, server는 `server-py` 빌드). `./deploy.sh`로 rsync 후 재기동.
