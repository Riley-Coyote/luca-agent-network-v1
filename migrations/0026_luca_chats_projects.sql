-- Luca Chats keep Buzz channels as the transport primitive while allowing
-- mutable participants and one optional Project binding.

ALTER TABLE channels
    ADD COLUMN project_id UUID;

CREATE INDEX idx_channels_community_project_activity
    ON channels (community_id, project_id, updated_at DESC)
    WHERE project_id IS NOT NULL AND deleted_at IS NULL;
