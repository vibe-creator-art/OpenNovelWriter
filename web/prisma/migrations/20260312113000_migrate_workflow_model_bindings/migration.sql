UPDATE "Workflow"
SET "stepsJson" = COALESCE(
    (
        SELECT json_group_array(
            CASE
                WHEN json_extract(step.value, '$.type') = 'llm_call' THEN json_set(
                    json_remove(step.value, '$.modelGroupId'),
                    '$.modelGroupIds',
                    CASE
                        WHEN json_type(step.value, '$.modelGroupIds') = 'array' THEN json(json_extract(step.value, '$.modelGroupIds'))
                        WHEN trim(COALESCE(json_extract(step.value, '$.modelGroupId'), '')) <> '' THEN json_array(trim(json_extract(step.value, '$.modelGroupId')))
                        ELSE json('[]')
                    END,
                    '$.modelSetIds',
                    CASE
                        WHEN json_type(step.value, '$.modelSetIds') = 'array' THEN json(json_extract(step.value, '$.modelSetIds'))
                        ELSE json('[]')
                    END
                )
                ELSE step.value
            END
        )
        FROM json_each("Workflow"."stepsJson") AS step
    ),
    '[]'
)
WHERE "stepsJson" <> '[]';
