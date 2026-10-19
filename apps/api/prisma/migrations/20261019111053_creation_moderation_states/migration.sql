-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CreationStatus" ADD VALUE 'CHANGES_REQUESTED';
ALTER TYPE "CreationStatus" ADD VALUE 'SUSPENDED';

-- CreateTable
CREATE TABLE "creation_review_decisions" (
    "id" UUID NOT NULL,
    "creationId" UUID NOT NULL,
    "revisionId" UUID,
    "adminId" UUID NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creation_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creation_review_decisions_creationId_createdAt_idx" ON "creation_review_decisions"("creationId", "createdAt");

-- CreateIndex
CREATE INDEX "creation_images_path_idx" ON "creation_images"("path");

-- AddForeignKey
ALTER TABLE "creation_review_decisions" ADD CONSTRAINT "creation_review_decisions_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creation_review_decisions" ADD CONSTRAINT "creation_review_decisions_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "creation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creation_review_decisions" ADD CONSTRAINT "creation_review_decisions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
