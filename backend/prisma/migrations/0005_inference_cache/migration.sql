-- Reuse temperature-0 Lyzr responses for identical (agent, instructions, redacted input).
CREATE TABLE "InferenceCache" (
    "key" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHitAt" TIMESTAMP(3),
    CONSTRAINT "InferenceCache_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "LyzrExecution" ADD COLUMN "cacheHit" BOOLEAN NOT NULL DEFAULT false;
