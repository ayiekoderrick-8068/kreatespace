-- CreateEnum
CREATE TYPE "DeletionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "deletedUserId" UUID,
    "roleAtRequest" "UserRole" NOT NULL,
    "hadBusiness" BOOLEAN NOT NULL,
    "status" "DeletionStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_deletion_requests_status_scheduledFor_idx" ON "account_deletion_requests"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "account_deletion_requests_userId_idx" ON "account_deletion_requests"("userId");

-- CreateIndex
CREATE INDEX "account_deletion_requests_deletedUserId_idx" ON "account_deletion_requests"("deletedUserId");

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A person may have only one request in progress at a time. The API checks this too; the index
-- makes it hold even when two requests arrive together.
CREATE UNIQUE INDEX "account_deletion_one_active_per_user"
  ON "account_deletion_requests"("userId")
  WHERE "status" IN ('REQUESTED', 'APPROVED');

-- Like every table, closed to the public Data API (see 20261020000600_lock_down_data_api).
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;