ALTER TABLE "CodexConnection" ADD COLUMN "upstreamFormat" TEXT;
ALTER TABLE "CodexConnection" ADD COLUMN "baseUrl" TEXT;
ALTER TABLE "CodexConnection" ADD COLUMN "encryptedApiKey" TEXT;
ALTER TABLE "CodexConnection" ADD COLUMN "defaultModelId" TEXT;
ALTER TABLE "CodexConnection" ADD COLUMN "modelsJson" TEXT NOT NULL DEFAULT '[]';
