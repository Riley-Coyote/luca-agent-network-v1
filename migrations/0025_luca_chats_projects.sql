-- Luca Chats keep Buzz channels as the transport primitive while allowing
-- mutable participants and one optional Project binding.

ALTER TABLE channels
    ADD COLUMN project_id UUID;

CREATE INDEX idx_channels_community_project_activity
    ON channels (community_id, project_id, updated_at DESC)
    WHERE project_id IS NOT NULL AND deleted_at IS NULL;

-- Legacy DM creation inserted every participant as `member`, including the
-- creator. Mutable membership requires a durable owner, so repair that role
-- without changing any other participant.
UPDATE channel_members AS cm
SET role = 'owner'
FROM channels AS c
WHERE cm.community_id = c.community_id
  AND cm.channel_id = c.id
  AND cm.pubkey = c.created_by
  AND cm.removed_at IS NULL
  AND c.channel_type = 'dm';
