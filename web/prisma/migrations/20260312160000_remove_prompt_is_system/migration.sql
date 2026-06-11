PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "messagesJson" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT,
    "historyJson" TEXT NOT NULL DEFAULT '[]',
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
    "messagesJson",
    "description",
    "historyJson",
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
    "messagesJson",
    "description",
    "historyJson",
    "isNsfw",
    "sortOrder",
    "ownerId",
    "createdAt",
    "updatedAt"
FROM "Prompt";

DROP TABLE "Prompt";
ALTER TABLE "new_Prompt" RENAME TO "Prompt";
CREATE INDEX "Prompt_ownerId_idx" ON "Prompt"("ownerId");
CREATE INDEX "Prompt_ownerId_category_idx" ON "Prompt"("ownerId", "category");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
