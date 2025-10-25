-- Migration: Add indexes for scene_versions table (Real-time Collaboration)
-- Date: 2025-09-30
-- Purpose: Optimize queries for Yjs update retrieval and compaction

-- Index already exists from the model definition:
-- idx_scene_versions_scene_id_created_at

-- Verify the index exists and add if missing
CREATE INDEX IF NOT EXISTS idx_scene_versions_scene_id_created_at 
ON scene_versions(scene_id, created_at DESC);

-- Additional index for efficient version history queries
CREATE INDEX IF NOT EXISTS idx_scene_versions_created_at 
ON scene_versions(created_at DESC);

-- Check table structure
-- Ensure these columns exist:
-- - version_id UUID PRIMARY KEY
-- - scene_id UUID NOT NULL REFERENCES scenes(scene_id) ON DELETE CASCADE
-- - yjs_update BYTEA NOT NULL
-- - created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()

-- Query to verify table structure:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'scene_versions' 
-- ORDER BY ordinal_position;

-- Query to verify indexes:
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'scene_versions';
