-- CreateEnum
CREATE TYPE "WebsiteRequestType" AS ENUM ('NEW_WEBSITE', 'REDESIGN', 'ONLINE_SHOP', 'OTHER');

-- CreateEnum
CREATE TYPE "WebsiteRequestStatus" AS ENUM ('NEW', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "website_requests" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "type" "WebsiteRequestType" NOT NULL,
    "description" TEXT NOT NULL,
    "budget" TEXT,
    "timeline" TEXT,
    "status" "WebsiteRequestStatus" NOT NULL DEFAULT 'NEW',
    "responseNote" TEXT,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "website_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_requests_businessId_createdAt_idx" ON "website_requests"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "website_requests_status_createdAt_idx" ON "website_requests"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "website_requests" ADD CONSTRAINT "website_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A business may have only one open request at a time. The API checks this too; the index makes it
-- hold even when two requests arrive together or something else writes to the table.
CREATE UNIQUE INDEX "website_requests_one_open_per_business"
  ON "website_requests"("businessId")
  WHERE "status" IN ('NEW', 'IN_REVIEW', 'QUOTED', 'ACCEPTED');