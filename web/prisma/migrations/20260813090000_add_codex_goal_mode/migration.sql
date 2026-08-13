ALTER TABLE "CodexSession" ADD COLUMN "composerMode" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CodexSession" ADD COLUMN "goalJson" TEXT;

UPDATE "CodexSession"
SET "composerMode" = 'plan'
WHERE "planMode" = 1;

ALTER TABLE "CodexSession" DROP COLUMN "planMode";
