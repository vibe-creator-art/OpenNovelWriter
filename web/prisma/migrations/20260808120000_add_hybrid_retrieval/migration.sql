ALTER TABLE "Novel" ADD COLUMN "retrievalEmbeddingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Novel" ADD COLUMN "retrievalEmbeddingAssignmentId" TEXT;
ALTER TABLE "Novel" ADD COLUMN "retrievalRerankerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Novel" ADD COLUMN "retrievalRerankerAssignmentId" TEXT;
ALTER TABLE "Novel" ADD COLUMN "retrievalTopK" INTEGER NOT NULL DEFAULT 10;

CREATE TABLE "SceneRetrievalIndex" (
    "sceneId" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "embeddingJson" TEXT,
    "embeddingHash" TEXT,
    "embeddingAssignmentId" TEXT,
    "embeddingModelId" TEXT,
    "embeddingDimensions" INTEGER,
    "embeddingError" TEXT,
    "embeddingUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SceneRetrievalIndex_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SceneRetrievalIndex_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SceneRetrievalIndex_novelId_idx" ON "SceneRetrievalIndex"("novelId");
CREATE INDEX "SceneRetrievalIndex_novelId_embeddingAssignmentId_idx" ON "SceneRetrievalIndex"("novelId", "embeddingAssignmentId");
