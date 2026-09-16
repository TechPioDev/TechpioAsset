-- Persistent enrolment token + safe device credential rotation + honest status.
--
-- Additive and nullable only: 34 laptops on agent v1.0.0 keep enrolling and
-- reporting exactly as before. No new tables, so RLS coverage is unchanged
-- (both tables already carry tenant_isolation from 20260906022856).

ALTER TABLE "agent_enrolment_tokens"
  ADD COLUMN "tokenCiphertext" TEXT,
  ADD COLUMN "graceTokenHash" TEXT,
  ADD COLUMN "graceExpiresAt" TIMESTAMP(3);

ALTER TABLE "device_agents"
  ADD COLUMN "previousTokenHash" TEXT,
  ADD COLUMN "previousTokenRotatedAt" TIMESTAMP(3),
  ADD COLUMN "lastRejectedAt" TIMESTAMP(3),
  ADD COLUMN "rejectCount" INTEGER NOT NULL DEFAULT 0;

-- A plain index, not a partial unique one: hashes of 256-bit random tokens
-- cannot collide in practice, a partial unique index cannot be expressed in
-- schema.prisma (it would show as drift on every migrate diff), and the guard
-- already refuses a previous hash that is ambiguous.
CREATE INDEX "device_agents_previousTokenHash_idx" ON "device_agents"("previousTokenHash");
