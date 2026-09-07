-- CreateEnum
CREATE TYPE "SpecFieldType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'ENUM');

-- CreateEnum
CREATE TYPE "NumericIntent" AS ENUM ('AT_LEAST', 'AT_MOST', 'EXACTLY');

-- CreateTable
CREATE TABLE "category_spec_fields" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" "SpecFieldType" NOT NULL DEFAULT 'TEXT',
    "unit" TEXT,
    "intent" "NumericIntent",
    "tolerance" DECIMAL(4,3),
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isComparable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "category_spec_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_spec_fields_companyId_categoryId_sortOrder_idx" ON "category_spec_fields"("companyId", "categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "category_spec_fields_deletedAt_idx" ON "category_spec_fields"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "category_spec_fields_companyId_categoryId_key_key" ON "category_spec_fields"("companyId", "categoryId", "key");

-- AddForeignKey
ALTER TABLE "category_spec_fields" ADD CONSTRAINT "category_spec_fields_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_spec_fields" ADD CONSTRAINT "category_spec_fields_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

