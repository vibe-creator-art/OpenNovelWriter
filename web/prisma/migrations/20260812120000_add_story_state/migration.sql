ALTER TABLE "Novel" ADD COLUMN "retrievalEmbeddingGroupId" TEXT;
ALTER TABLE "Novel" ADD COLUMN "retrievalRerankerGroupId" TEXT;

UPDATE "Novel"
SET "retrievalEmbeddingGroupId" = (
    SELECT "groupId"
    FROM "AiModelAssignment"
    WHERE "AiModelAssignment"."id" = "Novel"."retrievalEmbeddingAssignmentId"
)
WHERE "retrievalEmbeddingAssignmentId" IS NOT NULL;

UPDATE "Novel"
SET "retrievalRerankerGroupId" = (
    SELECT "groupId"
    FROM "AiModelAssignment"
    WHERE "AiModelAssignment"."id" = "Novel"."retrievalRerankerAssignmentId"
)
WHERE "retrievalRerankerAssignmentId" IS NOT NULL;

ALTER TABLE "Novel" DROP COLUMN "retrievalEmbeddingAssignmentId";
ALTER TABLE "Novel" DROP COLUMN "retrievalRerankerAssignmentId";

ALTER TABLE "SceneRetrievalIndex" ADD COLUMN "embeddingGroupId" TEXT;

UPDATE "SceneRetrievalIndex"
SET "embeddingGroupId" = (
    SELECT "groupId"
    FROM "AiModelAssignment"
    WHERE "AiModelAssignment"."id" = "SceneRetrievalIndex"."embeddingAssignmentId"
)
WHERE "embeddingAssignmentId" IS NOT NULL;

DROP INDEX "SceneRetrievalIndex_novelId_embeddingAssignmentId_idx";
CREATE INDEX "SceneRetrievalIndex_novelId_embeddingGroupId_idx"
ON "SceneRetrievalIndex"("novelId", "embeddingGroupId");

CREATE TABLE "StoryMoment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "sourceSceneId" TEXT,
    "label" TEXT NOT NULL,
    "storyOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryMoment_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryMoment_sourceSceneId_fkey" FOREIGN KEY ("sourceSceneId") REFERENCES "Scene" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryMoment_label_check" CHECK (length(trim("label")) > 0)
);

CREATE UNIQUE INDEX "StoryMoment_novelId_storyOrder_key" ON "StoryMoment"("novelId", "storyOrder");
CREATE INDEX "StoryMoment_novelId_idx" ON "StoryMoment"("novelId");
CREATE INDEX "StoryMoment_sourceSceneId_idx" ON "StoryMoment"("sourceSceneId");

CREATE TABLE "StoryEpisode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceSceneId" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "referenceMomentId" TEXT,
    "replacesEpisodeId" TEXT,
    "inactiveAt" DATETIME,
    "inactiveReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryEpisode_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryEpisode_sourceSceneId_fkey" FOREIGN KEY ("sourceSceneId") REFERENCES "Scene" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryEpisode_referenceMomentId_fkey" FOREIGN KEY ("referenceMomentId") REFERENCES "StoryMoment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryEpisode_replacesEpisodeId_fkey" FOREIGN KEY ("replacesEpisodeId") REFERENCES "StoryEpisode" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryEpisode_sourceKind_check" CHECK ("sourceKind" IN ('SCENE_SUMMARY', 'MANUAL')),
    CONSTRAINT "StoryEpisode_inactiveReason_check" CHECK ("inactiveReason" IS NULL OR "inactiveReason" IN ('SUPERSEDED', 'SOURCE_DELETED', 'MANUAL_RETRACTED')),
    CONSTRAINT "StoryEpisode_inactive_pair_check" CHECK (("inactiveAt" IS NULL) = ("inactiveReason" IS NULL))
);

CREATE UNIQUE INDEX "StoryEpisode_replacesEpisodeId_key" ON "StoryEpisode"("replacesEpisodeId");
CREATE UNIQUE INDEX "StoryEpisode_current_scene_unique"
ON "StoryEpisode"("sourceSceneId")
WHERE "sourceKind" = 'SCENE_SUMMARY' AND "inactiveAt" IS NULL AND "sourceSceneId" IS NOT NULL;
CREATE INDEX "StoryEpisode_novelId_sourceKind_inactiveAt_idx" ON "StoryEpisode"("novelId", "sourceKind", "inactiveAt");
CREATE INDEX "StoryEpisode_sourceSceneId_inactiveAt_idx" ON "StoryEpisode"("sourceSceneId", "inactiveAt");
CREATE INDEX "StoryEpisode_referenceMomentId_idx" ON "StoryEpisode"("referenceMomentId");

CREATE TABLE "StoryEntity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "termId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryEntity_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryEntity_kind_check" CHECK ("kind" IN ('CHARACTER', 'LOCATION', 'ITEM', 'ORGANIZATION', 'EVENT', 'INFORMATION', 'CONCEPT', 'OTHER')),
    CONSTRAINT "StoryEntity_name_check" CHECK (length(trim("name")) > 0)
);

CREATE INDEX "StoryEntity_novelId_normalizedName_idx" ON "StoryEntity"("novelId", "normalizedName");
CREATE INDEX "StoryEntity_novelId_termId_idx" ON "StoryEntity"("novelId", "termId");
CREATE INDEX "StoryEntity_novelId_kind_idx" ON "StoryEntity"("novelId", "kind");

CREATE TABLE "StoryEntityAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryEntityAlias_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryEntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "StoryEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryEntityAlias_sourceKind_check" CHECK ("sourceKind" IN ('TERM', 'MANUAL', 'EXTRACTED')),
    CONSTRAINT "StoryEntityAlias_alias_check" CHECK (length(trim("alias")) > 0)
);

CREATE UNIQUE INDEX "StoryEntityAlias_entityId_normalizedAlias_key" ON "StoryEntityAlias"("entityId", "normalizedAlias");
CREATE INDEX "StoryEntityAlias_novelId_normalizedAlias_idx" ON "StoryEntityAlias"("novelId", "normalizedAlias");
CREATE INDEX "StoryEntityAlias_novelId_entityId_idx" ON "StoryEntityAlias"("novelId", "entityId");

CREATE TABLE "StoryFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "subjectEntityId" TEXT NOT NULL,
    "predicateKey" TEXT NOT NULL,
    "objectEntityId" TEXT,
    "objectValue" TEXT,
    "factText" TEXT NOT NULL,
    "validFromMomentId" TEXT,
    "validToMomentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryFact_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryFact_subjectEntityId_fkey" FOREIGN KEY ("subjectEntityId") REFERENCES "StoryEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryFact_objectEntityId_fkey" FOREIGN KEY ("objectEntityId") REFERENCES "StoryEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryFact_validFromMomentId_fkey" FOREIGN KEY ("validFromMomentId") REFERENCES "StoryMoment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryFact_validToMomentId_fkey" FOREIGN KEY ("validToMomentId") REFERENCES "StoryMoment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryFact_object_check" CHECK (("objectEntityId" IS NULL) != ("objectValue" IS NULL)),
    CONSTRAINT "StoryFact_predicate_check" CHECK (length(trim("predicateKey")) > 0),
    CONSTRAINT "StoryFact_text_check" CHECK (length(trim("factText")) > 0)
);

CREATE INDEX "StoryFact_novelId_subjectEntityId_predicateKey_idx" ON "StoryFact"("novelId", "subjectEntityId", "predicateKey");
CREATE INDEX "StoryFact_novelId_objectEntityId_idx" ON "StoryFact"("novelId", "objectEntityId");
CREATE INDEX "StoryFact_novelId_validFromMomentId_validToMomentId_idx" ON "StoryFact"("novelId", "validFromMomentId", "validToMomentId");

CREATE TABLE "StoryFactEvidence" (
    "factId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("factId", "episodeId"),
    CONSTRAINT "StoryFactEvidence_factId_fkey" FOREIGN KEY ("factId") REFERENCES "StoryFact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryFactEvidence_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "StoryEpisode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryFactEvidence_role_check" CHECK ("role" IN ('SUPPORTS', 'INVALIDATES'))
);

CREATE INDEX "StoryFactEvidence_episodeId_role_idx" ON "StoryFactEvidence"("episodeId", "role");

CREATE TABLE "StoryRetrievalIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "embeddingJson" TEXT,
    "embeddingHash" TEXT,
    "embeddingGroupId" TEXT,
    "embeddingAssignmentId" TEXT,
    "embeddingModelId" TEXT,
    "embeddingDimensions" INTEGER,
    "embeddingError" TEXT,
    "embeddingUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryRetrievalIndex_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryRetrievalIndex_sourceKind_check" CHECK ("sourceKind" IN ('ENTITY', 'FACT', 'EPISODE'))
);

CREATE UNIQUE INDEX "StoryRetrievalIndex_novelId_sourceKind_sourceId_key" ON "StoryRetrievalIndex"("novelId", "sourceKind", "sourceId");
CREATE INDEX "StoryRetrievalIndex_novelId_sourceKind_idx" ON "StoryRetrievalIndex"("novelId", "sourceKind");
CREATE INDEX "StoryRetrievalIndex_novelId_embeddingGroupId_idx" ON "StoryRetrievalIndex"("novelId", "embeddingGroupId");
