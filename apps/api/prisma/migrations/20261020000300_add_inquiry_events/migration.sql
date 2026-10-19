-- CreateEnum
CREATE TYPE "InquiryEventType" AS ENUM ('CREATION_VIEW', 'BUSINESS_VIEW', 'WHATSAPP_CLICK', 'WEBSITE_CLICK');

-- CreateTable
CREATE TABLE "inquiry_events" (
    "id" UUID NOT NULL,
    "type" "InquiryEventType" NOT NULL,
    "businessId" UUID NOT NULL,
    "creationId" UUID,
    "packageId" UUID,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inquiry_events_businessId_createdAt_idx" ON "inquiry_events"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "inquiry_events_creationId_type_idx" ON "inquiry_events"("creationId", "type");

-- CreateIndex
CREATE INDEX "inquiry_events_type_createdAt_idx" ON "inquiry_events"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "inquiry_events" ADD CONSTRAINT "inquiry_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;