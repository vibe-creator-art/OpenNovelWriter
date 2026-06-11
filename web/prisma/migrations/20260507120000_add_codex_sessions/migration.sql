-- CreateTable
CREATE TABLE "CodexSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "title" TEXT,
    "titleManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
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

-- CreateIndex
CREATE INDEX "CodexSession_novelId_category_updatedAt_idx" ON "CodexSession"("novelId", "category", "updatedAt");

-- CreateIndex
CREATE INDEX "CodexSession_ownerId_idx" ON "CodexSession"("ownerId");

-- CreateIndex
CREATE INDEX "CodexSession_codexThreadId_idx" ON "CodexSession"("codexThreadId");
