-- Permission tombstones are not events: deleting messages must never restore access.
CREATE TABLE task_history_authority (
    community_id UUID NOT NULL,
    owner BYTEA NOT NULL,
    exchange_id TEXT NOT NULL,
    channel_id UUID NOT NULL,
    reader BYTEA NOT NULL,
    grant_event_id BYTEA NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (community_id, owner, exchange_id, reader)
);
CREATE INDEX task_history_source_reader ON task_history_authority (community_id, channel_id, reader);
CREATE TABLE task_history_source_revocations (
    community_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    reader BYTEA NOT NULL,
    PRIMARY KEY (community_id, channel_id, reader)
);
