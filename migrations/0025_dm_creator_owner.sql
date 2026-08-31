-- DM creators own the conversation lifecycle. Early DM creation assigned
-- every participant the member role, which made authenticated deletion
-- impossible even for the creator.
UPDATE channel_members AS membership
SET role = 'owner'::member_role
FROM channels AS channel
WHERE membership.community_id = channel.community_id
  AND membership.channel_id = channel.id
  AND membership.pubkey = channel.created_by
  AND membership.removed_at IS NULL
  AND channel.deleted_at IS NULL
  AND channel.channel_type = 'dm'
  AND membership.role <> 'owner'::member_role;
