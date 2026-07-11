-- CreateTable
CREATE TABLE "NovelWritingDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "netWordCount" INTEGER NOT NULL DEFAULT 0,
    "endingWordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NovelWritingDay_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NovelWritingDay_novelId_dateKey_key" ON "NovelWritingDay"("novelId", "dateKey");

-- CreateIndex
CREATE INDEX "NovelWritingDay_novelId_dateKey_idx" ON "NovelWritingDay"("novelId", "dateKey");
