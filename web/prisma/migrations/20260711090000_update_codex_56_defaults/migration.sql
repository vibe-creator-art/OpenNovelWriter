PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CodexSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "title" TEXT,
    "titleManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "reviewLevel" TEXT NOT NULL DEFAULT 'user_review',
    "modelId" TEXT NOT NULL DEFAULT 'gpt-5.6-sol',
    "reasoningEffort" TEXT NOT NULL DEFAULT 'high',
    "serviceTier" TEXT NOT NULL DEFAULT 'standard',
    "planMode" BOOLEAN NOT NULL DEFAULT false,
    "codexThreadId" TEXT,
    "codexConnectionId" TEXT,
    "draftContent" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "lastError" TEXT,
    "messagesJson" TEXT NOT NULL DEFAULT '[]',
    "novelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodexSession_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodexSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_CodexSession" ("category", "codexConnectionId", "codexThreadId", "createdAt", "draftContent", "id", "lastError", "messagesJson", "modelId", "novelId", "ownerId", "planMode", "reasoningEffort", "reviewLevel", "serviceTier", "status", "title", "titleManuallyEdited", "updatedAt")
SELECT "category", "codexConnectionId", "codexThreadId", "createdAt", "draftContent", "id", "lastError", "messagesJson", "modelId", "novelId", "ownerId", "planMode", "reasoningEffort", "reviewLevel", "serviceTier", "status", "title", "titleManuallyEdited", "updatedAt" FROM "CodexSession";

DROP TABLE "CodexSession";
ALTER TABLE "new_CodexSession" RENAME TO "CodexSession";
CREATE INDEX "CodexSession_novelId_category_updatedAt_idx" ON "CodexSession"("novelId", "category", "updatedAt");
CREATE INDEX "CodexSession_ownerId_idx" ON "CodexSession"("ownerId");
CREATE INDEX "CodexSession_codexThreadId_idx" ON "CodexSession"("codexThreadId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
