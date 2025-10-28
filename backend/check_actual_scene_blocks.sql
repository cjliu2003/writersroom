-- Check actual block structure in scenes table
SELECT
    scene_heading,
    jsonb_pretty(content_blocks[1]) as first_block,
    jsonb_pretty(content_blocks[2]) as second_block
FROM scenes
WHERE script_id = 'd0253e04-c5ce-4128-98d7-690b589c5850'
ORDER BY position
LIMIT 1;
