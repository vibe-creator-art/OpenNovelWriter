-- CreateTable
CREATE TABLE "AiModelSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModelSet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiModelSetMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModelSetMember_setId_fkey" FOREIGN KEY ("setId") REFERENCES "AiModelSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModelSetMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AiModelGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiModelSetMember_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiModelSet_ownerId_idx" ON "AiModelSet"("ownerId");

-- CreateIndex
CREATE INDEX "AiModelSet_ownerId_sortOrder_idx" ON "AiModelSet"("ownerId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AiModelSetMember_setId_groupId_key" ON "AiModelSetMember"("setId", "groupId");

-- CreateIndex
CREATE INDEX "AiModelSetMember_ownerId_idx" ON "AiModelSetMember"("ownerId");

-- CreateIndex
CREATE INDEX "AiModelSetMember_setId_sortOrder_idx" ON "AiModelSetMember"("setId", "sortOrder");

-- CreateIndex
CREATE INDEX "AiModelSetMember_groupId_idx" ON "AiModelSetMember"("groupId");

