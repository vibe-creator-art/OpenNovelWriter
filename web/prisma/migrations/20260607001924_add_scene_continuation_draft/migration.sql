-- CreateTable
CREATE TABLE "SceneContinuationDraft" (
    "panelId" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "codexSessionId" TEXT,
    "skillId" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "planning" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SceneContinuationDraft_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SceneContinuationDraft_novelId_idx" ON "SceneContinuationDraft"("novelId");

-- CreateIndex
CREATE INDEX "SceneContinuationDraft_sceneId_idx" ON "SceneContinuationDraft"("sceneId");

-- CreateIndex
CREATE INDEX "SceneContinuationDraft_codexSessionId_idx" ON "SceneContinuationDraft"("codexSessionId");
