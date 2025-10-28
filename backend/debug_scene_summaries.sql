-- Debug query to check scene_summaries persistence
-- Run this after generating an AI summary

-- 1. Check if scene_summaries column exists and has data
SELECT
    script_id,
    title,
    scene_summaries,
    jsonb_pretty(scene_summaries) as formatted_summaries,
    updated_at
FROM scripts
WHERE scene_summaries IS NOT NULL
ORDER BY updated_at DESC
LIMIT 5;

-- 2. Check specific script (replace with your script_id)
-- SELECT
--     script_id,
--     title,
--     scene_summaries,
--     jsonb_pretty(scene_summaries) as formatted_summaries
-- FROM scripts
-- WHERE script_id = 'YOUR_SCRIPT_ID_HERE';

-- 3. Check all scripts to see which have summaries
SELECT
    script_id,
    title,
    CASE
        WHEN scene_summaries IS NULL THEN 'NULL'
        WHEN scene_summaries = '{}' THEN 'Empty object'
        ELSE jsonb_object_keys(scene_summaries)::text || ' keys'
    END as summary_status,
    updated_at
FROM scripts
ORDER BY updated_at DESC
LIMIT 10;
