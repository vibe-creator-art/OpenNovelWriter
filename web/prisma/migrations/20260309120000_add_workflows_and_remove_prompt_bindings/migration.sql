/*
  Warnings:

  - You are about to drop the column `inputsJson` on the `Prompt` table. All the data in the column will be lost.
  - You are about to drop the column `modelGroupIdsJson` on the `Prompt` table. All the data in the column will be lost.
  - You are about to drop the column `modelSetIdsJson` on the `Prompt` table. All the data in the column will be lost.
  - You are about to drop the `PromptDefault` table. If the table is not empty, all the data it contains will be lost.
*/

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "messagesJson" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT,
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isNsfw" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prompt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Prompt" (
    "id",
    "name",
    "category",
    "content",
    "messagesJson",
    "description",
    "historyJson",
    "isSystem",
    "isNsfw",
    "sortOrder",
    "ownerId",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "name",
    "category",
    "content",
    "messagesJson",
    "description",
    "historyJson",
    "isSystem",
    "isNsfw",
    "sortOrder",
    "ownerId",
    "createdAt",
    "updatedAt"
FROM "Prompt";

DROP TABLE "PromptDefault";
DROP TABLE "Prompt";
ALTER TABLE "new_Prompt" RENAME TO "Prompt";
CREATE INDEX "Prompt_ownerId_idx" ON "Prompt"("ownerId");
CREATE INDEX "Prompt_ownerId_category_idx" ON "Prompt"("ownerId", "category");

CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "inputsJson" TEXT NOT NULL DEFAULT '[]',
    "stepsJson" TEXT NOT NULL DEFAULT '[]',
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workflow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Workflow_ownerId_idx" ON "Workflow"("ownerId");
CREATE INDEX "Workflow_ownerId_category_idx" ON "Workflow"("ownerId", "category");
CREATE INDEX "Workflow_ownerId_sortOrder_idx" ON "Workflow"("ownerId", "sortOrder");

CREATE TABLE "WorkflowDefault" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowDefault_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowDefault_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkflowDefault_ownerId_category_key" ON "WorkflowDefault"("ownerId", "category");
CREATE INDEX "WorkflowDefault_ownerId_idx" ON "WorkflowDefault"("ownerId");
CREATE INDEX "WorkflowDefault_workflowId_idx" ON "WorkflowDefault"("workflowId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
