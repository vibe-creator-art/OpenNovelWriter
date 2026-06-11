-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EditorChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "sentContent" TEXT,
    "fullRenderedContent" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "termIdsJson" TEXT NOT NULL DEFAULT '[]',
    "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
    "conversationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EditorChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "EditorChatConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EditorChatMessage" ("completionTokens", "content", "conversationId", "createdAt", "fullRenderedContent", "id", "promptTokens", "role", "sentContent", "termIdsJson", "totalTokens") SELECT "completionTokens", "content", "conversationId", "createdAt", "fullRenderedContent", "id", "promptTokens", "role", "sentContent", "termIdsJson", "totalTokens" FROM "EditorChatMessage";
DROP TABLE "EditorChatMessage";
ALTER TABLE "new_EditorChatMessage" RENAME TO "EditorChatMessage";
CREATE INDEX "EditorChatMessage_conversationId_createdAt_idx" ON "EditorChatMessage"("conversationId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
