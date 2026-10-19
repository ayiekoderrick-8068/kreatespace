-- CreateEnum
CREATE TYPE "CreationStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "occasions" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "occasions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creations" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "status" "CreationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedRevisionId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creation_revisions" (
    "id" UUID NOT NULL,
    "creationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "occasionId" UUID,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creation_images" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creation_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_creations" (
    "userId" UUID NOT NULL,
    "creationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_creations_pkey" PRIMARY KEY ("userId","creationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "occasions_slug_key" ON "occasions"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "creations_publishedRevisionId_key" ON "creations"("publishedRevisionId");

-- CreateIndex
CREATE INDEX "creations_status_publishedAt_idx" ON "creations"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "creations_businessId_idx" ON "creations"("businessId");

-- CreateIndex
CREATE INDEX "creation_revisions_categoryId_idx" ON "creation_revisions"("categoryId");

-- CreateIndex
CREATE INDEX "creation_revisions_occasionId_idx" ON "creation_revisions"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "creation_revisions_creationId_version_key" ON "creation_revisions"("creationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "creation_images_revisionId_position_key" ON "creation_images"("revisionId", "position");

-- CreateIndex
CREATE INDEX "saved_creations_userId_createdAt_idx" ON "saved_creations"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "creations" ADD CONSTRAINT "creations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creations" ADD CONSTRAINT "creations_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "creation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creation_revisions" ADD CONSTRAINT "creation_revisions_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creation_revisions" ADD CONSTRAINT "creation_revisions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creation_revisions" ADD CONSTRAINT "creation_revisions_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "occasions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creation_images" ADD CONSTRAINT "creation_images_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "creation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_creations" ADD CONSTRAINT "saved_creations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_creations" ADD CONSTRAINT "saved_creations_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "creations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An approved creation must point at the revision visitors see.
ALTER TABLE "creations"
  ADD CONSTRAINT "creation_published_revision_required"
  CHECK ("status" <> 'APPROVED' OR "publishedRevisionId" IS NOT NULL);

-- Full-text search over what customers type: title and description.
CREATE INDEX "creation_revisions_search_idx" ON "creation_revisions"
  USING GIN (to_tsvector('english', "title" || ' ' || "description"));

-- Category list used by discovery: Cakes, Fashion, Beauty, Photography, Event Decor, Flowers, Creative Gifts.
UPDATE "categories" SET "slug" = 'beauty', "name" = 'Beauty', "sortOrder" = 3 WHERE "slug" = 'beauty-makeup';
UPDATE "categories" SET "slug" = 'photography', "sortOrder" = 4 WHERE "slug" = 'photography';
UPDATE "categories" SET "slug" = 'event-decor', "name" = 'Event Decor', "sortOrder" = 5 WHERE "slug" = 'event-decoration';
UPDATE "categories" SET "slug" = 'flowers', "name" = 'Flowers', "sortOrder" = 6 WHERE "slug" = 'flowers-gifts';
INSERT INTO "categories" ("id", "slug", "name", "sortOrder") VALUES (gen_random_uuid(), 'creative-gifts', 'Creative Gifts', 7);

INSERT INTO "occasions" ("id", "slug", "name", "sortOrder") VALUES
  (gen_random_uuid(), 'birthday', 'Birthday', 1),
  (gen_random_uuid(), 'wedding', 'Wedding', 2),
  (gen_random_uuid(), 'bridal', 'Bridal', 3),
  (gen_random_uuid(), 'graduation', 'Graduation', 4),
  (gen_random_uuid(), 'anniversary', 'Anniversary', 5),
  (gen_random_uuid(), 'baby-shower', 'Baby Shower', 6),
  (gen_random_uuid(), 'corporate', 'Corporate Event', 7),
  (gen_random_uuid(), 'valentines', 'Valentine''s Day', 8),
  (gen_random_uuid(), 'everyday', 'Everyday', 99);
