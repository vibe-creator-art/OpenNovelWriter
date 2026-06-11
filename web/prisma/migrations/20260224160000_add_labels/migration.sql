-- AlterTable
ALTER TABLE "Act" ADD COLUMN "labelIdsJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN "labelIdsJson" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "novelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Label_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Label_novelId_idx" ON "Label"("novelId");

-- CreateIndex
CREATE INDEX "Label_novelId_sortOrder_idx" ON "Label"("novelId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Label_novelId_name_key" ON "Label"("novelId", "name");

