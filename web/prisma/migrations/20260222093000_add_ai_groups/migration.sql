-- CreateTable
CREATE TABLE "AiModelGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "failurePolicyJson" TEXT NOT NULL DEFAULT '{}',
    "pricingTiersJson" TEXT NOT NULL DEFAULT '[]',
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModelGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiModelAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredUntil" DATETIME,
    "manuallyDisabled" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModelAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AiModelGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModelAssignment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AiConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModelAssignment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiModelGroup_ownerId_idx" ON "AiModelGroup"("ownerId");

-- CreateIndex
CREATE INDEX "AiModelGroup_ownerId_sortOrder_idx" ON "AiModelGroup"("ownerId", "sortOrder");

-- CreateIndex
CREATE INDEX "AiModelAssignment_ownerId_idx" ON "AiModelAssignment"("ownerId");

-- CreateIndex
CREATE INDEX "AiModelAssignment_groupId_sortOrder_idx" ON "AiModelAssignment"("groupId", "sortOrder");

-- CreateIndex
CREATE INDEX "AiModelAssignment_connectionId_idx" ON "AiModelAssignment"("connectionId");
