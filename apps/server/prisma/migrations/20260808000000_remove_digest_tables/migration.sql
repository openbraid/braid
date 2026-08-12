-- Remove the daily-digest feature.
--
-- DESTRUCTIVE: these three tables are dropped with their data. That is
-- intentional and safe to do unconditionally: every row in them was derived
-- output (LLM-generated daily summaries and the artifact snapshots taken only
-- to feed them). Nothing here is user-authored and nothing else references it —
-- the digest module, its controller and its Prisma models were all removed in
-- the same change. Re-adding the feature later means regenerating, not
-- recovering.
--
-- The User.workosId → User.subjectId rename in the same schema change produces
-- no SQL: the field kept its @map("workos_id") column, so it is a Prisma-level
-- rename only and existing databases are untouched.

-- DropForeignKey
ALTER TABLE "artifact_snapshots" DROP CONSTRAINT "artifact_snapshots_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "workspace_digests" DROP CONSTRAINT "workspace_digests_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "project_digests" DROP CONSTRAINT "project_digests_project_id_fkey";

-- DropTable
DROP TABLE "artifact_snapshots";

-- DropTable
DROP TABLE "workspace_digests";

-- DropTable
DROP TABLE "project_digests";

