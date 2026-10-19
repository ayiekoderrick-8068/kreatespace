-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportItemStatus" AS ENUM ('PENDING_REVIEW', 'DUPLICATE', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "import_authorizations" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "grantedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "import_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "authorizationId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "startUrl" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_items" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrls" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "ImportItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "duplicateReason" TEXT,
    "duplicateOfCreationId" UUID,
    "creationId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_authorizations_businessId_idx" ON "import_authorizations"("businessId");

-- CreateIndex
CREATE INDEX "import_jobs_businessId_createdAt_idx" ON "import_jobs"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_status_createdAt_idx" ON "import_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "import_items_jobId_status_idx" ON "import_items"("jobId", "status");

-- CreateIndex
CREATE INDEX "import_items_businessId_contentHash_idx" ON "import_items"("businessId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "import_items_businessId_sourceUrl_key" ON "import_items"("businessId", "sourceUrl");

-- AddForeignKey
ALTER TABLE "import_authorizations" ADD CONSTRAINT "import_authorizations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_authorizations" ADD CONSTRAINT "import_authorizations_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "import_authorizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_duplicateOfCreationId_fkey" FOREIGN KEY ("duplicateOfCreationId") REFERENCES "creations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One live authorisation per business and domain; revoking frees the slot.
CREATE UNIQUE INDEX "import_authorizations_one_active"
  ON "import_authorizations"("businessId", "domain")
  WHERE "revokedAt" IS NULL;

-- One import at a time per business, so a crawl can never be started twice by accident.
CREATE UNIQUE INDEX "import_jobs_one_running_per_business"
  ON "import_jobs"("businessId")
  WHERE "status" IN ('QUEUED', 'RUNNING');