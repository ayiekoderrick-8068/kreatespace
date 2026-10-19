-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "service_packages" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "reviewState" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_review_decisions" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_packages_businessId_status_idx" ON "service_packages"("businessId", "status");

-- CreateIndex
CREATE INDEX "service_packages_reviewState_idx" ON "service_packages"("reviewState");

-- CreateIndex
CREATE INDEX "package_review_decisions_packageId_createdAt_idx" ON "package_review_decisions"("packageId", "createdAt");

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_review_decisions" ADD CONSTRAINT "package_review_decisions_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_review_decisions" ADD CONSTRAINT "package_review_decisions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A package can only be public if it has a published version.
ALTER TABLE "service_packages"
  ADD CONSTRAINT "package_published_consistent"
  CHECK (("published" IS NULL) = ("publishedAt" IS NULL));
