-- Check existing indexes on critical tables
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('scene_embeddings', 'scene_summaries', 'scenes', 'chat_conversations', 'chat_messages')
ORDER BY tablename, indexname;

-- Add missing indexes if they don't exist
-- These will speed up the RAG context building and chat operations

-- Index on scene_embeddings.script_id (for filtering embeddings by script)
CREATE INDEX IF NOT EXISTS idx_scene_embeddings_script_id
ON scene_embeddings(script_id);

-- Index on scene_summaries.script_id (for fetching summaries by script)
CREATE INDEX IF NOT EXISTS idx_scene_summaries_script_id
ON scene_summaries(script_id);

-- Composite index on scenes for script + position lookups (used in neighbor retrieval)
CREATE INDEX IF NOT EXISTS idx_scenes_script_id_position
ON scenes(script_id, position);

-- Index on chat_conversations.script_id (for fetching conversations by script)
CREATE INDEX IF NOT EXISTS idx_chat_conversations_script_id
ON chat_conversations(script_id);

-- Index on chat_messages.conversation_id (for fetching messages by conversation)
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
ON chat_messages(conversation_id);

-- Index on chat_messages created_at for ordering (used in recent message retrieval)
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
ON chat_messages(created_at DESC);

-- Verify all indexes were created
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname LIKE 'idx_%'
AND tablename IN ('scene_embeddings', 'scene_summaries', 'scenes', 'chat_conversations', 'chat_messages')
ORDER BY tablename, indexname;
