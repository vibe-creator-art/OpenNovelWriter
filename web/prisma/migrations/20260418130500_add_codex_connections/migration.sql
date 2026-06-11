-- CreateTable
CREATE TABLE "CodexConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "note" TEXT,
    "authStatus" TEXT NOT NULL DEFAULT 'unauthenticated',
    "authType" TEXT,
    "accountEmail" TEXT,
    "accountPlan" TEXT,
    "lastAuthError" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodexConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CodexConnection_ownerId_idx" ON "CodexConnection"("ownerId");

-- CreateIndex
CREATE INDEX "CodexConnection_ownerId_authStatus_idx" ON "CodexConnection"("ownerId", "authStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CodexConnection_ownerId_name_key" ON "CodexConnection"("ownerId", "name");
