UPDATE "Prompt"
SET "category" = 'scene_action'
WHERE "category" = 'scene_summary';

UPDATE "PromptDefault"
SET "category" = 'scene_action'
WHERE "category" = 'scene_summary';
