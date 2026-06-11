ALTER TABLE "EditorChatMessage" ADD COLUMN "promptTokens" INTEGER;
ALTER TABLE "EditorChatMessage" ADD COLUMN "completionTokens" INTEGER;
ALTER TABLE "EditorChatMessage" ADD COLUMN "totalTokens" INTEGER;
