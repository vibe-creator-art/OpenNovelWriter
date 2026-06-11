-- AlterTable
ALTER TABLE "Novel" ADD COLUMN "authorName" TEXT;
ALTER TABLE "Novel" ADD COLUMN "language" TEXT DEFAULT 'en';
ALTER TABLE "Novel" ADD COLUMN "pointOfView" TEXT DEFAULT '3rd';
ALTER TABLE "Novel" ADD COLUMN "series" TEXT;
ALTER TABLE "Novel" ADD COLUMN "seriesIndex" INTEGER;
