-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('DRAFT', 'PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED', 'REINSTATED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "BusinessStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedRevisionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_revisions" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "businessName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "county" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "whatsappNumber" TEXT NOT NULL,
    "logoPath" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "contentAuthorizedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_images" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "revisionId" UUID,
    "adminId" UUID NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_ownerId_key" ON "businesses"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_publishedRevisionId_key" ON "businesses"("publishedRevisionId");

-- CreateIndex
CREATE INDEX "businesses_status_idx" ON "businesses"("status");

-- CreateIndex
CREATE INDEX "business_revisions_status_idx" ON "business_revisions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "business_revisions_businessId_version_key" ON "business_revisions"("businessId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "business_images_revisionId_position_key" ON "business_images"("revisionId", "position");

-- CreateIndex
CREATE INDEX "review_decisions_businessId_createdAt_idx" ON "review_decisions"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "business_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_revisions" ADD CONSTRAINT "business_revisions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_revisions" ADD CONSTRAINT "business_revisions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_images" ADD CONSTRAINT "business_images_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "business_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "business_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A business can have at most one revision in flight (draft, pending or awaiting changes).
CREATE UNIQUE INDEX "one_open_revision_per_business"
  ON "business_revisions" ("businessId")
  WHERE "status" IN ('DRAFT', 'PENDING', 'CHANGES_REQUESTED');

-- Approved or suspended businesses must point at the revision visitors see.
ALTER TABLE "businesses"
  ADD CONSTRAINT "published_revision_required"
  CHECK ("status" NOT IN ('APPROVED', 'SUSPENDED') OR "publishedRevisionId" IS NOT NULL);

-- Initial category list.
INSERT INTO "categories" ("id", "slug", "name", "sortOrder") VALUES
  (gen_random_uuid(), 'cakes', 'Cakes', 1),
  (gen_random_uuid(), 'fashion', 'Fashion', 2),
  (gen_random_uuid(), 'photography', 'Photography', 3),
  (gen_random_uuid(), 'beauty-makeup', 'Beauty & Makeup', 4),
  (gen_random_uuid(), 'event-decoration', 'Event Decoration', 5),
  (gen_random_uuid(), 'flowers-gifts', 'Flowers & Gifts', 6),
  (gen_random_uuid(), 'other', 'Other', 99);
