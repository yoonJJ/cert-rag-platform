-- server/prisma/migrations 와 동일한 스키마. 기존 DB 에 다시 실행해도 안전하도록 IF NOT EXISTS 로 작성합니다.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "Chunk" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "source" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Question" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "answer" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "examType" TEXT NOT NULL,
    "sourceDoc" TEXT NOT NULL,
    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WrongAnswer" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "myAnswer" INTEGER NOT NULL,
    "correctAnswer" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "examType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "nextReview" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WrongAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExamAttempt" (
    "id" TEXT NOT NULL,
    "examType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExamAttemptItem" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "picked" INTEGER NOT NULL,
    "answer" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "explanation" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "sourceDoc" TEXT NOT NULL,
    CONSTRAINT "ExamAttemptItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExamAttemptItem_attemptId_orderNo_idx" ON "ExamAttemptItem"("attemptId", "orderNo");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExamAttemptItem_attemptId_fkey') THEN
        ALTER TABLE "ExamAttemptItem" ADD CONSTRAINT "ExamAttemptItem_attemptId_fkey"
            FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ===== 문서 단위 관리 =====
-- 업로드 1건 = Document 1행. source(파일명)는 API 전반에서 문서 식별자로 쓰이므로 UNIQUE 입니다.
-- pageAccurate=false 는 이전 서버가 청크 순번을 page 로 저장했던 문서(재업로드 시 실제 페이지로 교체됨).
CREATE TABLE IF NOT EXISTS "Document" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileHash" TEXT,
    "mimeType" TEXT,
    "pageCount" INTEGER,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "imageCaptioned" BOOLEAN NOT NULL DEFAULT false,
    "pageAccurate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Document_source_key" ON "Document"("source");

ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "documentId" TEXT;
CREATE INDEX IF NOT EXISTS "Chunk_documentId_idx" ON "Chunk"("documentId");
CREATE INDEX IF NOT EXISTS "Chunk_source_page_idx" ON "Chunk"("source", "page");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Chunk_documentId_fkey') THEN
        ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 파일명(source)을 NFC 로 통일합니다. macOS 는 한글 파일명을 NFD(자모 분리)로 넘겨주는 경우가 있어
-- 같은 파일이 브라우저에 따라 다른 문서로 취급되는 것을 막습니다.
UPDATE "Chunk" SET "source" = normalize("source", NFC) WHERE "source" <> normalize("source", NFC);
UPDATE "ExamAttempt" SET "source" = normalize("source", NFC) WHERE "source" <> normalize("source", NFC);
-- 정규화하면 이름이 겹치는 문서는 NFC 쪽 문서로 합칩니다.
UPDATE "Chunk" c
   SET "documentId" = keep."id"
  FROM "Document" dup
  JOIN "Document" keep ON keep."source" = normalize(dup."source", NFC) AND keep."id" <> dup."id"
 WHERE c."documentId" = dup."id";
DELETE FROM "Document" dup
 USING "Document" keep
 WHERE keep."source" = normalize(dup."source", NFC) AND keep."id" <> dup."id";
UPDATE "Document" SET "source" = normalize("source", NFC) WHERE "source" <> normalize("source", NFC);

-- 기존 청크(문서 없이 source 문자열만 있던 데이터)를 문서로 묶습니다. 이미 묶인 청크는 건드리지 않습니다.
INSERT INTO "Document" ("id", "source", "chunkCount", "pageAccurate")
SELECT 'legacy_' || md5("source"), "source", COUNT(*), false
  FROM "Chunk"
 WHERE "documentId" IS NULL
 GROUP BY "source"
ON CONFLICT ("source") DO NOTHING;

UPDATE "Chunk" c
   SET "documentId" = d."id"
  FROM "Document" d
 WHERE c."documentId" IS NULL AND c."source" = d."source";
