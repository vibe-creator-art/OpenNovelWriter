/*
  Warnings:

  - You are about to drop the column `modelGroupId` on the `PromptDefault` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PromptDefault" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromptDefault_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromptDefault_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PromptDefault" ("category", "createdAt", "id", "ownerId", "promptId", "updatedAt") SELECT "category", "createdAt", "id", "ownerId", "promptId", "updatedAt" FROM "PromptDefault";
DROP TABLE "PromptDefault";
ALTER TABLE "new_PromptDefault" RENAME TO "PromptDefault";
CREATE INDEX "PromptDefault_ownerId_idx" ON "PromptDefault"("ownerId");
CREATE INDEX "PromptDefault_promptId_idx" ON "PromptDefault"("promptId");
CREATE UNIQUE INDEX "PromptDefault_ownerId_category_key" ON "PromptDefault"("ownerId", "category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
