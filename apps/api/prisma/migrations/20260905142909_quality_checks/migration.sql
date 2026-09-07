-- CreateEnum
CREATE TYPE "QualityOutcome" AS ENUM ('PASSED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "RejectDisposition" AS ENUM ('RETURN_TO_VENDOR', 'HOLD_DAMAGED');

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "goodsReceiptLineId" TEXT NOT NULL,
    "outcome" "QualityOutcome" NOT NULL,
    "quantityInspected" DECIMAL(14,3) NOT NULL,
    "quantityAccepted" DECIMAL(14,3) NOT NULL,
    "quantityRejected" DECIMAL(14,3) NOT NULL,
    "rejectionReason" TEXT,
    "disposition" "RejectDisposition",
    "notes" TEXT,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_checks_companyId_outcome_idx" ON "quality_checks"("companyId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "quality_checks_goodsReceiptLineId_key" ON "quality_checks"("goodsReceiptLineId");

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "goods_receipt_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

