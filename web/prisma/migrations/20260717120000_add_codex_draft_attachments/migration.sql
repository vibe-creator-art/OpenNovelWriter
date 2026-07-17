ALTER TABLE "CodexSession" ADD COLUMN "draftAttachmentsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "CodexSession" ADD COLUMN "draftArtifactsJson" TEXT NOT NULL DEFAULT '[]';
