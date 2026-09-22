-- Who is signed in on a reporting machine (v2.76).
--
-- The owner asked the laptop list to show who is using each machine. Agent
-- 1.2.0 reports the console account with each report; `activeUserAt` is the
-- time of the report that carried the field at all (a name OR "nobody"), so a
-- laptop still on an older agent reads "Needs agent 1.2.0" rather than
-- "Nobody signed in". Additive and nullable: every existing row keeps NULL.
ALTER TABLE "operating_system_info" ADD COLUMN "activeUser" TEXT;
ALTER TABLE "operating_system_info" ADD COLUMN "activeUserAt" TIMESTAMP(3);
