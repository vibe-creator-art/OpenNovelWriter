-- AlterTable
ALTER TABLE "Novel" ADD COLUMN "codexSessionAutoCleanup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Novel" ADD COLUMN "codexSessionRetentionLimit" INTEGER NOT NULL DEFAULT 10;
