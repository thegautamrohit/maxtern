-- CreateTable
CREATE TABLE "QueryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "rewrittenQuery" TEXT,
    "strategy" TEXT NOT NULL,
    "retrievedChunks" INTEGER NOT NULL,
    "topScore" DOUBLE PRECISION NOT NULL,
    "avgScore" DOUBLE PRECISION NOT NULL,
    "rerankerTopScore" DOUBLE PRECISION,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "estimatedCost" TEXT NOT NULL,
    "executionTimeMs" INTEGER NOT NULL,
    "ragUsed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryLog_pkey" PRIMARY KEY ("id")
);
