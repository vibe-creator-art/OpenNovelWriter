-- CreateTable
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "baseUrl" TEXT,
    "encryptedApiKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "modelsJson" TEXT NOT NULL DEFAULT '[]',
    "lastFetchedAt" DATETIME,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiConnection_ownerId_idx" ON "AiConnection"("ownerId");

-- CreateIndex
CREATE INDEX "AiConnection_ownerId_isActive_idx" ON "AiConnection"("ownerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AiConnection_ownerId_name_key" ON "AiConnection"("ownerId", "name");
