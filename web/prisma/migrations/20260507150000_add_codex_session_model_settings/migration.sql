ALTER TABLE "CodexSession" ADD COLUMN "modelId" TEXT NOT NULL DEFAULT 'gpt-5.4';
ALTER TABLE "CodexSession" ADD COLUMN "reasoningEffort" TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "CodexSession" ADD COLUMN "serviceTier" TEXT NOT NULL DEFAULT 'standard';
