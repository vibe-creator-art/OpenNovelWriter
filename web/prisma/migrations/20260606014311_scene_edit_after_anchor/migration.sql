-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SceneEdit" (
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
    "afterAnchorHtml" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SceneEdit_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SceneEdit" ("actNumber", "afterHtml", "afterText", "anchorHash", "beforeHtml", "beforeText", "chapterId", "createdAt", "id", "novelId", "sceneId", "sessionId", "status", "updatedAt") SELECT "actNumber", "afterHtml", "afterText", "anchorHash", "beforeHtml", "beforeText", "chapterId", "createdAt", "id", "novelId", "sceneId", "sessionId", "status", "updatedAt" FROM "SceneEdit";
DROP TABLE "SceneEdit";
ALTER TABLE "new_SceneEdit" RENAME TO "SceneEdit";
CREATE INDEX "SceneEdit_novelId_status_idx" ON "SceneEdit"("novelId", "status");
CREATE INDEX "SceneEdit_sceneId_status_idx" ON "SceneEdit"("sceneId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
