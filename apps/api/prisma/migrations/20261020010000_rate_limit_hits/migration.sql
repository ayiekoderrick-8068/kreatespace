-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_resetAt_idx" ON "rate_limit_hits"("resetAt");

-- Like every table, closed to the public Data API (see 20261020000600_lock_down_data_api).
ALTER TABLE "rate_limit_hits" ENABLE ROW LEVEL SECURITY;
