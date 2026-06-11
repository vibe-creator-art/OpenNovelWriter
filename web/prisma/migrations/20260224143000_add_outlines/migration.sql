-- CreateTable
CREATE TABLE "Outline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "actNumber" INTEGER,
    "chapterId" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "novelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Outline_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Outline_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Outline_chapterId_key" ON "Outline"("chapterId");
CREATE UNIQUE INDEX "Outline_novelId_type_actNumber_key" ON "Outline"("novelId", "type", "actNumber");
CREATE INDEX "Outline_novelId_idx" ON "Outline"("novelId");
CREATE INDEX "Outline_novelId_type_idx" ON "Outline"("novelId", "type");
CREATE INDEX "Outline_chapterId_idx" ON "Outline"("chapterId");

