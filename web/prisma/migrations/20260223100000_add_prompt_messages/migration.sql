-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN "messagesJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN "description" TEXT;

