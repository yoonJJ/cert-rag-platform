-- CreateTable
CREATE TABLE "ExamAttempt" (
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

-- CreateTable
CREATE TABLE "ExamAttemptItem" (
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

-- CreateIndex
CREATE INDEX "ExamAttemptItem_attemptId_orderNo_idx" ON "ExamAttemptItem"("attemptId", "orderNo");

-- AddForeignKey
ALTER TABLE "ExamAttemptItem" ADD CONSTRAINT "ExamAttemptItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
