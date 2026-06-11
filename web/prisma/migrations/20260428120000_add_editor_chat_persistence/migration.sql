-- CreateTable
CREATE TABLE "EditorChatConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "titleManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "promptId" TEXT,
    "selectedGroupId" TEXT,
    "draftContent" TEXT NOT NULL DEFAULT '',
    "promptSnapshotJson" TEXT,
    "inputStateJson" TEXT,
    "novelId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EditorChatConversation_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EditorChatConversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EditorChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "sentContent" TEXT,
    "fullRenderedContent" TEXT,
    "termIdsJson" TEXT NOT NULL DEFAULT '[]',
    "conversationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EditorChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "EditorChatConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EditorChatConversation_novelId_updatedAt_idx" ON "EditorChatConversation"("novelId", "updatedAt");

-- CreateIndex
CREATE INDEX "EditorChatConversation_ownerId_idx" ON "EditorChatConversation"("ownerId");

-- CreateIndex
CREATE INDEX "EditorChatMessage_conversationId_createdAt_idx" ON "EditorChatMessage"("conversationId", "createdAt");
