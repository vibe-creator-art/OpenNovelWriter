-- CreateTable
CREATE TABLE "SceneEdit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "actNumber" INTEGER NOT NULL DEFAULT 1,
    "sessionId" TEXT,
    "beforeHtml" TEXT NOT NULL DEFAULT '',
    "afterHtml" TEXT NOT NULL DEFAULT '',
    "beforeText" TEXT NOT NULL DEFAULT '',
    "afterText" TEXT NOT NULL DEFAULT '',
    "anchorHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SceneEdit_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SceneEdit_novelId_status_idx" ON "SceneEdit"("novelId", "status");

-- CreateIndex
CREATE INDEX "SceneEdit_sceneId_status_idx" ON "SceneEdit"("sceneId", "status");
