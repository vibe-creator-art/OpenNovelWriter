-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN "historyJson" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "PromptDefault" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromptDefault_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromptDefault_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptDefault_ownerId_category_key" ON "PromptDefault"("ownerId", "category");
CREATE INDEX "PromptDefault_ownerId_idx" ON "PromptDefault"("ownerId");
CREATE INDEX "PromptDefault_promptId_idx" ON "PromptDefault"("promptId");

