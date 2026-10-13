# 시험 플랫폼

**RAG + LLM API로 PDF 기출·교재를 바로 문제로 바꾸는 풀스택 학습 웹앱**

[![React](https://img.shields.io/badge/React-19+-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![FastAPI](https://img.shields.io/badge/Python-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![ChatGPT](https://img.shields.io/badge/OpenAI-ChatGPT-74aa9c?logo=openai&logoColor=white)](https://chatgpt.com/)
[![Google Gemini](https://img.shields.io/badge/Google-Gemini-1A73E8?logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Claude](https://img.shields.io/badge/Anthropic-Claude-D97757?logo=claude&logoColor=white)](https://claude.ai/)

---

## 한 줄 소개

업로드한 **PDF 텍스트를 청크·임베딩·벡터 검색**으로 묶고, 객관식 문제를 생성합니다. 채팅/생성은 **OpenAI / Gemini / Claude API** 중 선택해 사용할 수 있으며, **시험 모드·오답 노트·SSE AI 튜터**까지 한 화면 흐름으로 이어지도록 설계했습니다. 대시보드에서 모델을 전환하고(API 키 입력), 상단 바에서 **현재 모델과 연결 상태**를 확인할 수 있습니다.

---

## 왜 만들었나 (Problem → Solution)

| 배경 | 접근 |
|------|------|
| 자격증 준비 시 기출 PDF·강의자료가 산재하고, 문제집만으로는 내 약점과 맞물리기 어렵다 | **본인 자료를 그대로 RAG 컨텍스트**로 넣어, 원하는 토픽·난이도에 맞춰 문제를 **자연어로 생성** |
| 모델 종속 없이 상황에 맞는 LLM을 골라 쓰고 싶다 | **OpenAI / Gemini / Claude API**를 런타임에 전환할 수 있게 하고, DB는 **PostgreSQL + pgvector**로 검색 품질을 확보 |

---

## 내가 구현한 것 (역할 & 범위)

- **프론트엔드**: React + Vite + Tailwind, 대시보드·업로드·퀴즈·시험·오답 노트·벡터 디버그 UI
- **LLM UX**: 대시보드 **모델 드롭다운**, 전역 **`LlmStatusContext`** + 상단 **`LLM · 모델명`** pill(연결 상태 애니메이션)
- **백엔드**: FastAPI REST API (Express에서 이전), PDF 파싱·청킹, 임베딩 저장, 문제/시험/오답 CRUD, **`/api/settings/llm`**으로 런타임 채팅 모델 전환
- **AI 파이프라인**: OpenAI `text-embedding-3-small` 임베딩(768차원) + `<=>` 거리 기반 검색, **선택된 채팅 모델**로 JSON 구조화 문제 생성 및 재시도 파싱
- **실시간 UX**: AI 튜터 **SSE(Server-Sent Events)** 스트리밍
- **인프라**: Docker Compose로 PostgreSQL(pgvector)·Redis 구성, 기동 시 `schema.sql`로 스키마 자동 준비

---

## 주요 기능 (스크린 기준)

| 영역 | 설명 |
|------|------|
| **대시보드** | DB/LLM 헬스, **사용 중 LLM 카드 + 모델 선택**, 학습 소스·오답 요약 |
| **문서** | PDF·이미지 업로드 → PyMuPDF로 페이지별 텍스트 추출 → 청크마다 **실제 페이지 번호**를 붙여 벡터 저장. 같은 이름은 교체, 같은 파일은 건너뜀, 문서 삭제 지원 |
| **문제 풀기** | 업로드된 소스 선택 + 자연어 출제 지시 → 객관식 생성·진행·정답/해설·출처 표시 |
| **시험 모드** | 제한 시간·채점, 시도별 이력·상세 저장 (`ExamAttempt` / `ExamAttemptItem`) |
| **오답 노트** | 틀린 문항 저장·삭제, 동일 토픽 **유사 문제 재생성** |
| **AI 튜터** | 선택한 오답 맥락으로 스트리밍 해설 |
| **청크 뷰어** | 문서가 어떻게 잘려 저장됐는지 **페이지별로 묶어** 확인. 청크 펼쳐 보기·문서 내 검색(하이라이트)·글자 수 표시, `?source=` 링크로 바로 열기 |

메뉴는 **학습**(대시보드·문제 풀기·시험·오답 노트)과 **지식베이스**(문서·청크 뷰어) 두 묶음으로 나뉩니다. 예전 주소 `/upload`는 `/documents`로 이동합니다.

### 주요 화면 스크린샷

**문서** (`/documents`)

![PDF 업로드 완료](./docs/screenshots/upload-success.png)
![업로드된 PDF 목록](./docs/screenshots/upload-list.png)

**문제 풀이 + AI 튜터**

![문제 풀이 화면](./docs/screenshots/quiz-screen.png)
![AI 튜터 해설 화면](./docs/screenshots/tutor-screen.png)

**청크 뷰어** (`/vector-debug`)

![청크 메타데이터 뷰어](./docs/screenshots/vector-viewer.png)

---

## 채팅 LLM 모델 선택 (동작 방식)

- **UI**: 대시보드 드롭다운에서 변경 → `PUT /api/settings/llm`으로 서버 런타임 모델 갱신.
- **API 키 입력**: OpenAI/Gemini/Claude 선택 시 같은 입력 UI에서 API 키를 저장해 사용합니다.
- **적용 범위**: **문제 생성**, **PDF 업로드 후 토픽 추론**, **AI 튜터** 호출에 동일한 채팅 모델이 사용됩니다.
- **임베딩**: 검색 임베딩은 OpenAI `text-embedding-3-small`(768차원)을 사용하므로 RAG 기능에는 OpenAI API 키가 필요합니다.
- **주의**: 모델 선택과 API 키는 **서버 프로세스 메모리**에만 있어 재시작 시 초기화됩니다.

---

## 아키텍처 개요

```mermaid
flowchart TB
  subgraph client [Client]
    UI[React + Vite + Tailwind]
    LLMUI[LlmStatusContext + TopNav]
  end
  subgraph server [Server]
    API[FastAPI]
    SET[settings.py: LLM 선택]
    RAG[rag.py: embed / retrieve / generate]
    LLM[llm.py: Chat Router - OpenAI Gemini Claude]
  end
  subgraph data [Data]
    PG[(PostgreSQL + pgvector)]
    RD[(Redis)]
  end
  subgraph cloud [Cloud AI APIs]
    OA[OpenAI API: chat + embeddings]
    GM[Gemini API: chat]
    CL[Claude API: chat]
  end
  UI -->|REST + SSE| API
  LLMUI -->|GET/PUT settings/llm| API
  API --> SET
  API --> RAG
  RAG --> LLM
  RAG -->|embeddings| OA
  LLM --> OA
  LLM --> GM
  LLM --> CL
  API --> PG
  API -.-> RD
  RAG --> PG
```

---

## 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| Frontend | React, Vite, Tailwind CSS, React Router |
| Backend | Python 3.12, FastAPI, Uvicorn, asyncpg |
| DB | PostgreSQL, **pgvector** (asyncpg + Raw SQL) |
| AI | 채팅: **OpenAI / Gemini / Claude API** 선택, 임베딩: OpenAI `text-embedding-3-small`(768차원), OpenAI SDK + Anthropic API |
| Infra | Docker Compose (Postgres, Redis) |
| 기타 | SSE 스트리밍(`StreamingResponse`), PyMuPDF(PDF 텍스트 추출·페이지 렌더링) |

---

## 기술적으로 신경 쓴 점 (포트폴리오용 하이라이트)

- **소스 스코프 RAG**: 문제 생성 시 `source`로 청크를 한정해, 여러 PDF가 있어도 **의도한 교재만** 컨텍스트에 넣도록 설계
- **LLM 출력 안정화**: 코드펜스 제거·JSON 슬라이스·파싱 실패 시 **재시도**로 운영 중 깨짐을 줄임
- **런타임 채팅 모델 전환**: API 한 곳에서 `getChatModel()`을 읽어 생성·튜터·토픽 추론에 일관 적용
- **출처 가독화**: 검색된 청크의 파일명·페이지를 묶어 `sourceDoc` 형태로 표시
- **운영 편의**: 서버 기동 시 `CREATE EXTENSION IF NOT EXISTS vector`로 pgvector 활성화 자동화
- **프론트 API 레이어**: `VITE_API_URL`로 백엔드 베이스 URL 분리 (로컬/배포 전환 용이)

---

## 검색 품질 평가 (Evaluation)

RAG 시스템은 "동작한다"로 끝나면 안 되고 **얼마나 잘 검색·생성하는지 측정**되어야 한다고 보았습니다.
그래서 검색 품질을 표준 정보검색(IR) 지표로 정량 측정하는 평가 레이어를 추가했습니다. (`server/eval/`)

- **측정 지표**: Recall@k · Precision@k · nDCG@k · Hit@k · MRR (k = 3, 5, 10)
- **관련도 기준**: 정답 근거가 실린 PDF 페이지를 골드셋으로 두고, 검색된 청크의 페이지가 일치하면 관련으로 판정 (페이지 단위 관련도)
- **비교 실험**: `RUN_TAG`로 청크 크기·top-k·임베딩 모델을 바꿔 실행하고 결과를 비교해 트레이드오프를 분석
- **결과 저장**: 콘솔 표 + `eval/results/*.json|csv`

```bash
cd server
node eval/retrieval_eval.js                       # 기본 실행
RUN_TAG=topk5_chunk650 node eval/retrieval_eval.js # 실험 태그별 저장
```

> 로드맵: (2주차) **LLM-as-a-Judge** 기반 생성 품질 평가(근거성·정답정확성·답변가능성·오답매력도·난이도)와
> **판정자 신뢰성 검증**(사람 vs LLM-Judge 일치도, Cohen's κ)을 추가할 예정입니다.
> 자세한 내용은 [`server/eval/README.md`](server/eval/README.md) 참고.

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
├─ server-py/                  # ★ 현재 백엔드 (FastAPI)
│  ├─ app/main.py              # FastAPI 앱, health, 라우터 마운트
│  ├─ app/routes/              # upload, questions, exam, tutor, wrong, settings
│  ├─ app/services/            # llm, rag, chunker, pdf
│  ├─ app/schema.sql           # 테이블·pgvector 스키마 (기동 시 IF NOT EXISTS 로 적용)
│  └─ tests/                   # Node 버전과의 동작 비교 테스트
├─ server/                     # 이전 백엔드 (Express + Prisma, 참고용) + eval/
│  ├─ eval/                    # RAG 검색 품질 평가(IR 지표) + 골드셋
│  └─ prisma/schema.prisma
├─ ppt/                        # (선택) 포트폴리오 HTML / PDF보내기 스크립트
└─ docs/                       # 스택 아이콘 등 에셋
```

---

## 데이터 모델 (요약)

- **Document**: 업로드 1건 = 1행. 파일명(`source`, UNIQUE)·파일 해시·페이지 수·청크 수·캡션 여부·`pageAccurate`(이전 서버 데이터면 false)
- **Chunk**: PDF 청크 + 임베딩(`vector(768)`) + 소스/실제 페이지, `documentId`로 Document에 소속 (문서 삭제 시 함께 삭제)
- **Question**: 생성된 객관식 문제 영속화
- **WrongAnswer**: 오답 노트 (복습·유사 문제 생성 입력)
- **ExamAttempt / ExamAttemptItem**: 시험 회차·문항별 채점 스냅샷

아래 다이어그램은 `server-py/app/schema.sql`을 기준으로 했습니다(서버 시작 시 멱등 실행). `Chunk.embedding`은 asyncpg Raw SQL로 다룹니다.

### 도메인 클래스 다이어그램 (ER / 클래스 관점)

```mermaid
classDiagram
  direction TB

  class Document {
    +String id
    +String source
    +String fileHash
    +String mimeType
    +Int pageCount
    +Int chunkCount
    +Boolean imageCaptioned
    +Boolean pageAccurate
    +DateTime createdAt
  }

  class Chunk {
    +String id
    +String documentId
    +String content
    +String source
    +Int page
  }
  note for Chunk "embedding: pgvector vector(768)\nasyncpg Raw SQL ($1::text::vector)"

  Document "1" *-- "*" Chunk : chunks (onDelete Cascade)

  class Question {
    +String id
    +String content
    +Json options
    +Int answer
    +String explanation
    +String topic
    +String difficulty
    +String examType
    +String sourceDoc
  }

  class WrongAnswer {
    +String id
    +String question
    +Json options
    +Int myAnswer
    +Int correctAnswer
    +String explanation
    +String topic
    +String examType
    +DateTime createdAt
    +Int reviewCount
    +DateTime nextReview
  }

  class ExamAttempt {
    +String id
    +String examType
    +String source
    +String command
    +Int total
    +Int correct
    +Int percent
    +DateTime createdAt
  }

  class ExamAttemptItem {
    +String id
    +String attemptId
    +Int orderNo
    +String questionId
    +String question
    +Json options
    +Int picked
    +Int answer
    +Boolean isCorrect
    +String explanation
    +String topic
    +String sourceDoc
  }

  ExamAttempt "1" *-- "*" ExamAttemptItem : items (onDelete Cascade)
```

`Document`–`Chunk` 외에 `Question`, `WrongAnswer`는 스키마상 **FK로 연결되지 않으며**, `source`·`topic` 등 문자열로 업무 맥락을 맞춥니다.

### 유스케이스 다이어그램

**주 액터**는 자격증을 준비하는 **학습자**입니다. 외부 시스템은 **OpenAI/Gemini/Claude API(클라우드)**를 사용하며, 임베딩(RAG)은 **OpenAI API**로 처리합니다.

```mermaid
flowchart TB
  learner((학습자))
  openai[OpenAI API - 채팅 + 임베딩]
  gemini[Gemini API - 채팅]
  claude[Claude API - 채팅]

  subgraph sys [시험 플랫폼]
    direction TB
    uc1([UC1: 학습 현황 확인])
    uc2([UC2: 채팅 LLM 모델 선택])
    uc3([UC3: PDF 업로드·RAG 인덱싱])
    uc4([UC4: 문제 생성·퀴즈 풀이])
    uc5([UC5: 시험 시뮬레이션·채점·이력 저장])
    uc6([UC6: 오답 노트 관리])
    uc7([UC7: 유사 문제 재생성])
    uc8([UC8: AI 튜터 해설 - SSE 스트리밍])
    uc9([UC9: 문서별 청크 확인·검색])
  end

  learner --> uc1
  learner --> uc2
  learner --> uc3
  learner --> uc4
  learner --> uc5
  learner --> uc6
  learner --> uc7
  learner --> uc8
  learner --> uc9

  uc3 -.->|임베딩·토픽 추론| openai
  uc4 -.->|문제 JSON 생성 선택| openai
  uc7 -.->|문제 생성 선택| openai
  uc8 -.->|스트리밍 설명 선택| openai
  uc4 -.->|문제 생성 선택| gemini
  uc7 -.->|문제 생성 선택| gemini
  uc8 -.->|스트리밍 설명 선택| gemini
  uc4 -.->|문제 생성 선택| claude
  uc7 -.->|문제 생성 선택| claude
  uc8 -.->|스트리밍 설명 선택| claude
```

| 유스케이스 | 개요 |
|------------|------|
| UC1 | 대시보드에서 DB·LLM 상태, 소스·오답 요약 조회 |
| UC2 | 사용 중 채팅 모델 조회·변경 (`/api/settings/llm`) |
| UC3 | PDF 텍스트 추출 → 청킹 → `Chunk` + 벡터 저장 |
| UC4 | 소스·토픽 기준 RAG 검색 후 객관식 생성·풀이 |
| UC5 | 타이머 시험, 채점, `ExamAttempt`·`ExamAttemptItem` 저장 |
| UC6 | 틀린 문항 `WrongAnswer` 저장·삭제·목록 |
| UC7 | 오답 토픽 기준 유사 문제 재생성 |
| UC8 | 오답 맥락 + RAG 컨텍스트로 실시간 해설 |
| UC9 | 개발·검증용 벡터 유사도 검색 UI |

> GitHub·GitLab 등에서 Mermaid가 비활성화된 경우, VS Code 미리보기나 [Mermaid Live Editor](https://mermaid.live)에 코드를 붙여 넣어 확인할 수 있습니다.

---

## 빠른 시작

### 사전 준비

- Docker Desktop, Python 3.12+, Node.js 18+ (프론트엔드)
- LLM API 키: **OpenAI / Gemini / Claude 중 채팅용 1개 이상**, 그리고 임베딩(RAG)용 **OpenAI 키**

```bash
brew install --cask docker
```

> OpenAI/Gemini/Claude 모델은 각각 `*_CHAT_MODELS` 환경변수로 목록을 커스터마이징할 수 있습니다. API 키는 `server-py/.env` 또는 대시보드 UI에서 입력합니다.

### 인프라

```bash
docker compose up -d
```

`docker-compose.yml`의 `platform: linux/arm64`는 Apple Silicon 기준입니다. x86 환경에서는 해당 줄을 제거하거나 이미지/플랫폼을 환경에 맞게 조정하세요.

### 환경 변수

`server-py/.env` (템플릿은 `server-py/.env.example`):

```env
DATABASE_URL="postgresql://user:password@localhost:5432/certdb"
PORT=3001

# 기본 선택 옵션 ID (형식: provider/model)
# CHAT_MODEL=openai/gpt-4o-mini

# 임베딩(RAG) — OpenAI 키 사용, DB의 vector(768)에 맞춰 768차원
# EMBED_MODEL=text-embedding-3-small
# EMBED_DIMENSIONS=768

# OpenAI API (채팅 또는 임베딩 사용 시 필요)
# OPENAI_API_KEY=sk-...
# OPENAI_CHAT_MODELS=gpt-4o-mini|GPT-4o mini,gpt-4o|GPT-4o

# Gemini API
# GEMINI_API_KEY=AIza...
# GEMINI_CHAT_MODELS=gemini-2.0-flash|Gemini 2.0 Flash (프리티어),gemini-1.5-flash|Gemini 1.5 Flash (프리티어),gemini-1.5-pro|Gemini 1.5 Pro

# Claude API
# CLAUDE_API_KEY=sk-ant-...
# CLAUDE_CHAT_MODELS=claude-3-5-haiku-latest|Claude 3.5 Haiku,claude-3-5-sonnet-latest|Claude 3.5 Sonnet
```

`client/.env` (선택, CORS/포트 분리 시):

```env
VITE_API_URL="http://localhost:3001"
```

로컬에서 Vite 프록시만 쓰는 경우 `VITE_API_URL`은 비워 두어도 됩니다.

### 설치 및 DB

```bash
cd server-py && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd ../client && npm install
```

### 실행

```bash
# 터미널 1 (테이블·pgvector 확장은 기동 시 자동 생성)
cd server-py && .venv/bin/uvicorn app.main:app --reload --port 3001

# 터미널 2
cd client && npm run dev
```

- 앱: `http://localhost:5173`
- Health: `http://localhost:3001/api/health`
- 현재 LLM 설정 조회: `GET http://localhost:3001/api/settings/llm`
- API 문서(Swagger): `http://localhost:3001/docs`

---

## API 요약

**설정**:
- `GET /api/settings/llm`
- `PUT /api/settings/llm`
  - 모델 변경: `{ "model": "openai/gpt-4o-mini" }`, `{ "model": "gemini/gemini-2.0-flash" }`, `{ "model": "claude/claude-3-5-haiku-latest" }`
  - provider 키 저장: `{ "keyProvider": "openai|gemini|claude", "providerApiKey": "..." }`
  - provider 키 삭제: `{ "keyProvider": "openai|gemini|claude", "providerApiKey": "" }`

**업로드·소스**: `POST /api/upload` (같은 이름이면 교체, 같은 파일이면 건너뜀), `DELETE /api/sources?source=`, `GET /api/sources`, `GET /api/sources/stats`, `GET /api/sources/topics`, `GET /api/sources/metadata`, `GET /api/sources/chunks?source=&q=&limit=&offset=` (문서 내 순번·전체 내용·글자 수·문서 정보 포함, `q`로 내용 검색)

**문제·시험**: `POST /api/questions/generate`, `GET /api/vector/search`, `POST /api/exam/grade`, `GET /api/exam/attempts`, `GET /api/exam/attempts/:id`

**튜터·오답**: `GET /api/tutor` (SSE), `GET|POST /api/wrong`, `DELETE /api/wrong/:id`, `POST /api/wrong/:id/similar`

---

## 자주 쓰는 명령어

```bash
docker compose up -d
docker compose down
docker compose down -v

cd server-py
.venv/bin/pip install pytest && .venv/bin/python -m pytest   # Node 버전과의 동작 비교 테스트
```

---

## 트러블슈팅

- **`vector type does not exist`**: `docker compose up -d` 후 서버 재시작. 부트 시 `vector` 확장 자동 생성.
- **`Can't reach database server at localhost:5432`**: Postgres 컨테이너가 떠 있는지, `DATABASE_URL` 호스트·포트·DB명이 `docker-compose.yml`과 맞는지 확인.
- **프론트 API 실패**: `VITE_API_URL`과 백엔드 `PORT` 일치 여부 확인.
- **임베딩/RAG 실패 (`OpenAI API 키를 입력해 주세요`)**: PDF 업로드·벡터 검색·문제 생성에는 OpenAI 키가 필요합니다. `OPENAI_API_KEY` 또는 대시보드에서 키를 저장했는지 확인하세요.
- **모델 호출 실패 (404)**: 선택한 provider에서 해당 모델 ID가 유효한지 확인하세요.
- **요청 제한 (429)**: 해당 provider 쿼터/레이트 제한입니다. 잠시 후 재시도하거나 다른 모델로 변경하세요.
- **OpenAI/Gemini/Claude 호출 실패**: 해당 provider API 키가 저장되어 있는지 확인하세요.
- **모델 변경이 안 먹는 것 같음**: 선택/키는 서버 메모리라 재시작 시 초기화됩니다. 동일 서버 인스턴스에 요청이 가는지(프록시/포트) 확인하세요.

---

## 향후 확장 아이디어

- 선택한 LLM을 **파일/DB에 영속화**해 재시작 후에도 유지
- 사용자·인증 및 멀티테넌시 — [설계 노트: login.md](./login.md)
- Redis를 활용한 시험 세션·레이트 리밋
- 적응형 난이도·학습 스트릭 대시보드 — [설계 노트: adaptive-streak.md](./adaptive-streak.md)
- 배포: Fly.io / Railway / AWS 등 + CI 파이프라인

---

## 보안 점검 이력

- **2026-06-11** — `npm audit` 기준 client/server 취약점 0건으로 정리
  - **CVE-2025-55182 (React2Shell)**: Next.js/React Server Components 미사용으로 비해당 확인 (React 19.2.4)
  - client: `react-router-dom` 7.17.0 (turbo-stream 역직렬화 RCE 등 수정), `vite` 8.0.16 (dev 서버 파일 노출 수정), `postcss` 8.5.15
  - server: `qs`·`defu`·`effect`(prisma 전이 의존성) 등 호환 범위 내 갱신
  - 주요 의존성을 `latest` 선언에서 명시적 버전 범위로 고정해 재현 가능한 설치 확보
  - 인프라: Docker Desktop 4.77.0 (Linux 커널 CopyFail, CVE-2026-31431 패치 포함)

---

## 라이선스 및 비고

개인 학습·**포트폴리오 목적** 프로젝트입니다.
