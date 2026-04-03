# IT 자격증 학습 플랫폼

**RAG + 로컬 LLM으로 PDF 기출·교재를 바로 문제로 바꾸는 풀스택 학습 웹앱**

[![React](https://img.shields.io/badge/React-19+-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-latest-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_LLM-000000)](https://ollama.com/)

---

## 한 줄 소개

업로드한 **PDF 텍스트를 청크·임베딩·벡터 검색**으로 묶고, **Ollama**로 객관식 문제를 생성합니다. **시험 모드·오답 노트·SSE AI 튜터**까지 한 화면 흐름으로 이어지도록 설계했습니다. 대시보드에서 **채팅/생성용 LLM 모델을 선택**할 수 있고, 상단 바에 **현재 모델과 연결 상태**가 표시됩니다.

---

## 왜 만들었나 (Problem → Solution)

| 배경 | 접근 |
|------|------|
| 자격증 준비 시 기출 PDF·강의자료가 산재하고, 문제집만으로는 내 약점과 맞물리기 어렵다 | **본인 자료를 그대로 RAG 컨텍스트**로 넣어, 원하는 토픽·난이도에 맞춰 문제를 **자연어로 생성** |
| 외부 유료 API에 의존하면 비용·데이터 이슈가 크다 | **Ollama 로컬 추론**으로 채팅·임베딩을 통합하고, DB는 **PostgreSQL + pgvector**로 검색 품질을 확보 |

---

## 내가 구현한 것 (역할 & 범위)

- **프론트엔드**: React + Vite + Tailwind, 대시보드·업로드·퀴즈·시험·오답 노트·벡터 디버그 UI
- **LLM UX**: 대시보드 **모델 드롭다운**, 전역 **`LlmStatusContext`** + 상단 **`LLM · 모델명`** pill(연결 상태 애니메이션)
- **백엔드**: Express REST API, PDF 파싱·청킹, 임베딩 저장, 문제/시험/오답 CRUD, **`/api/settings/llm`**으로 런타임 채팅 모델 전환
- **AI 파이프라인**: `nomic-embed-text` 임베딩(고정) + `<=>` 거리 기반 검색, **선택된 채팅 모델**로 JSON 구조화 문제 생성 및 재시도 파싱
- **실시간 UX**: AI 튜터 **SSE(Server-Sent Events)** 스트리밍
- **인프라**: Docker Compose로 PostgreSQL(pgvector)·Redis 구성, Prisma 마이그레이션·스키마 관리

---

## 주요 기능 (스크린 기준)

| 영역 | 설명 |
|------|------|
| **대시보드** | DB/LLM 헬스, **사용 중 LLM 카드 + 모델 선택**, 학습 소스·오답 요약 |
| **PDF 업로드** | `pdf-parse`로 텍스트 추출 → 청크 분할 → 벡터 저장 (소스별 메타·토픽 추출 API) |
| **문제 풀기** | 업로드된 소스 선택 + 자연어 출제 지시 → 객관식 생성·진행·정답/해설·출처 표시 |
| **시험 모드** | 제한 시간·채점, 시도별 이력·상세 저장 (`ExamAttempt` / `ExamAttemptItem`) |
| **오답 노트** | 틀린 문항 저장·삭제, 동일 토픽 **유사 문제 재생성** |
| **AI 튜터** | 선택한 오답 맥락으로 스트리밍 해설 |
| **청크 뷰어** | 벡터 검색 디버그용 (`/api/vector/search` 등) |

> 스크린샷을 넣고 싶다면 `README`에 `![대시보드](./docs/screenshots/dashboard.png)` 형태로 이미지를 추가하면 포트폴리오 완성도가 올라갑니다.

---

## 채팅 LLM 모델 선택 (동작 방식)

- **UI**: 대시보드 드롭다운에서 변경 → `PUT /api/settings/llm` → 서버 메모리의 현재 모델 ID 갱신.
- **적용 범위**: **문제 생성**, **PDF 업로드 후 토픽 추론**, **AI 튜터** 호출에 동일한 `model`이 사용됩니다.
- **임베딩**: `nomic-embed-text`는 모델 선택과 무관하게 고정입니다.
- **주의**: 선택 값은 **프로세스 메모리**에만 있어 **서버 재시작 시** `CHAT_MODEL` 또는 후보 목록의 첫 항목 기준으로 초기화됩니다. Ollama에 실제로 존재하는 모델 태그(`ollama list`)와 ID가 일치해야 합니다.

---

## 아키텍처 개요

```mermaid
flowchart TB
  subgraph client [Client]
    UI[React + Vite + Tailwind]
    LLMUI[LlmStatusContext + TopNav]
  end
  subgraph server [Server]
    API[Express]
    SET[settings.js: LLM 선택]
    RAG[rag.js: embed / retrieve / generate]
    LLM[llm.js: OpenAI-compatible → Ollama]
  end
  subgraph data [Data]
    PG[(PostgreSQL + pgvector)]
    RD[(Redis)]
  end
  subgraph local [Local AI]
    OL[Ollama: chat + embeddings]
  end
  UI -->|REST + SSE| API
  LLMUI -->|GET/PUT settings/llm| API
  API --> SET
  API --> RAG
  RAG --> LLM
  LLM --> OL
  API --> PG
  API -.-> RD
  RAG --> PG
```

---

## 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| Frontend | React, Vite, Tailwind CSS, React Router |
| Backend | Node.js (ESM), Express, Multer |
| DB / ORM | PostgreSQL, **pgvector**, Prisma |
| AI | Ollama — **선택 가능 채팅 모델**(기본 `gpt-oss:20b`, `gemma4:26b`), 임베딩 `nomic-embed-text`, OpenAI SDK 호환 클라이언트 |
| Infra | Docker Compose (Postgres, Redis) |
| 기타 | SSE 스트리밍, `pdf-parse` |

---

## 기술적으로 신경 쓴 점 (포트폴리오용 하이라이트)

- **소스 스코프 RAG**: 문제 생성 시 `source`로 청크를 한정해, 여러 PDF가 있어도 **의도한 교재만** 컨텍스트에 넣도록 설계
- **LLM 출력 안정화**: 코드펜스 제거·JSON 슬라이스·파싱 실패 시 **재시도**로 운영 중 깨짐을 줄임
- **런타임 채팅 모델 전환**: API 한 곳에서 `getChatModel()`을 읽어 생성·튜터·토픽 추론에 일관 적용
- **출처 가독화**: 검색된 청크의 파일명·페이지를 묶어 `sourceDoc` 형태로 표시
- **운영 편의**: 서버 기동 시 `CREATE EXTENSION IF NOT EXISTS vector`로 pgvector 활성화 자동화
- **프론트 API 레이어**: `VITE_API_URL`로 백엔드 베이스 URL 분리 (로컬/배포 전환 용이)

---

## 프로젝트 구조

```text
AIProject/
├─ docker-compose.yml          # PostgreSQL(pgvector), Redis
├─ client/
│  ├─ src/pages/               # Dashboard, Upload, QuizMode, ExamMode, WrongNote, VectorDebug
│  ├─ src/components/          # QuestionCard, TutorPanel, PageLayout, TopNav
│  ├─ src/context/             # LlmStatusContext (전역 LLM 상태·폴링)
│  └─ src/lib/api.js           # fetch 래퍼 + VITE_API_URL
├─ server/
│  ├─ index.js                 # Express, health, 라우터 마운트
│  ├─ routes/                  # upload, questions, exam, tutor, wrong, settings
│  ├─ services/                # llm, rag, chunker
│  └─ prisma/schema.prisma
├─ ppt/                        # (선택) 포트폴리오 HTML / PDF보내기 스크립트
└─ docs/                       # 스택 아이콘 등 에셋
```

---

## 데이터 모델 (요약)

- **Chunk**: PDF 청크 + 임베딩(`vector(768)`) + 소스/페이지
- **Question**: 생성된 객관식 문제 영속화
- **WrongAnswer**: 오답 노트 (복습·유사 문제 생성 입력)
- **ExamAttempt / ExamAttemptItem**: 시험 회차·문항별 채점 스냅샷

---

## 빠른 시작

### 사전 준비

- Docker Desktop, Node.js 18+, Ollama

```bash
brew install --cask docker
brew install ollama
ollama pull gpt-oss:20b
ollama pull gemma4:26b
ollama pull nomic-embed-text
```

> 사용하는 채팅 모델 태그는 `ollama list`와 일치해야 합니다. 다른 이름이면 `server/.env`의 `OLLAMA_CHAT_MODELS`로 후보를 직접 적어 주세요.

### 인프라

```bash
docker compose up -d
```

`docker-compose.yml`의 `platform: linux/arm64`는 Apple Silicon 기준입니다. x86 환경에서는 해당 줄을 제거하거나 이미지/플랫폼을 환경에 맞게 조정하세요.

### 환경 변수

`server/.env` (템플릿은 `server/.env.example`):

```env
DATABASE_URL="postgresql://user:password@localhost:5432/certdb"
OLLAMA_BASE_URL="http://localhost:11434/v1"
OLLAMA_API_KEY="ollama"
REDIS_URL="redis://localhost:6379"
PORT=3001

# 선택: 기동 시 기본 채팅 모델 (후보 목록에 있는 id)
# CHAT_MODEL=gpt-oss:20b

# 선택: 드롭다운 후보. 생략 시 gpt-oss:20b + gemma4:26b
# OLLAMA_CHAT_MODELS=gpt-oss:20b|GPT-OSS 20B,gemma4:26b|Gemma 4 26B
```

`client/.env` (선택, CORS/포트 분리 시):

```env
VITE_API_URL="http://localhost:3001"
```

로컬에서 Vite 프록시만 쓰는 경우 `VITE_API_URL`은 비워 두어도 됩니다.

### 설치 및 DB

```bash
cd server && npm install && npx prisma migrate dev --name init && npx prisma generate
cd ../client && npm install
```

### 실행

```bash
# 터미널 1
ollama serve

# 터미널 2
cd server && npm run dev

# 터미널 3
cd client && npm run dev
```

- 앱: `http://localhost:5173`
- Health: `http://localhost:3001/api/health`
- 현재 LLM 설정 조회: `GET http://localhost:3001/api/settings/llm`

---

## API 요약

**설정**: `GET /api/settings/llm`, `PUT /api/settings/llm` (body: `{ "model": "<ollama-model-id>" }`)

**업로드·소스**: `POST /api/upload`, `GET /api/sources`, `GET /api/sources/stats`, `GET /api/sources/topics`, `GET /api/sources/metadata`, `GET /api/sources/chunks`

**문제·시험**: `POST /api/questions/generate`, `GET /api/vector/search`, `POST /api/exam/grade`, `GET /api/exam/attempts`, `GET /api/exam/attempts/:id`

**튜터·오답**: `GET /api/tutor` (SSE), `GET|POST /api/wrong`, `DELETE /api/wrong/:id`, `POST /api/wrong/:id/similar`

---

## 자주 쓰는 명령어

```bash
docker compose up -d
docker compose down
docker compose down -v

cd server
npx prisma studio
npx prisma migrate reset

ollama list
ollama ps
```

---

## 트러블슈팅

- **`vector type does not exist`**: `docker compose up -d` 후 서버 재시작. 부트 시 `vector` 확장 자동 생성.
- **`Can't reach database server at localhost:5432`**: Postgres 컨테이너가 떠 있는지, `DATABASE_URL` 호스트·포트·DB명이 `docker-compose.yml`과 맞는지 확인.
- **프론트 API 실패**: `VITE_API_URL`과 백엔드 `PORT` 일치 여부 확인.
- **문제 생성 실패·지연**: `ollama serve` 및 채팅/임베딩 모델 설치 여부 확인. 모델 id는 UI 후보와 `ollama list`의 이름이 같아야 합니다.
- **모델 변경이 안 먹는 것 같음**: API 서버를 재시작하면 선택이 초기화됩니다. 같은 서버 인스턴스에서 `PUT /api/settings/llm` 후 요청이 그 서버로 가는지(프록시/포트) 확인하세요.

---

## 향후 확장 아이디어

- 선택한 LLM을 **파일/DB에 영속화**해 재시작 후에도 유지
- 사용자·인증 및 멀티테넌시
- Redis를 활용한 시험 세션·레이트 리밋
- 적응형 난이도·학습 스트릭 대시보드
- 배포: Fly.io / Railway / AWS 등 + CI 파이프라인

---

## 라이선스 및 비고

개인 학습·**포트폴리오 목적** 프로젝트입니다.
