-- Agent check-in and "Refresh now" (v3.14).
--
-- Agents from 1.3.0 check in every five minutes, which is what lets the
-- portal say Online or Offline instead of "reported some time this week".
-- Both columns start empty: every agent installed today reads exactly as it
-- did yesterday until it is updated. Nothing else changes.
ALTER TABLE "device_agents"
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "refreshRequestedAt" TIMESTAMP(3),
  ADD COLUMN "refreshRequestedById" TEXT;
