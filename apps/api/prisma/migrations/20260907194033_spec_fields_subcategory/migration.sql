-- DropIndex
DROP INDEX "category_spec_fields_companyId_categoryId_key_key";

-- AlterTable
ALTER TABLE "category_spec_fields" ADD COLUMN     "subcategoryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "category_spec_fields_companyId_categoryId_subcategoryId_key_key" ON "category_spec_fields"("companyId", "categoryId", "subcategoryId", "key");

-- AddForeignKey
ALTER TABLE "category_spec_fields" ADD CONSTRAINT "category_spec_fields_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Postgres treats NULLs as distinct in a unique index, so the constraint above
-- stops two duplicates within one subcategory but would happily allow two
-- category-level fields with the same key. This closes that half.
CREATE UNIQUE INDEX "category_spec_fields_company_category_key_when_no_subcategory"
  ON "category_spec_fields" ("companyId", "categoryId", "key")
  WHERE "subcategoryId" IS NULL;
