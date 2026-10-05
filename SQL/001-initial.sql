-- The baseline schema.
CREATE TABLE IF NOT EXISTS Guilds (
    guild_id      INTEGER NOT NULL PRIMARY KEY,
    first_seen_at INTEGER NOT NULL, -- unix ms
    backfilled_at INTEGER           -- unix ms, NULL until the backfill finishes
) STRICT;

CREATE TABLE IF NOT EXISTS GuildEvents (
    guild_id   INTEGER NOT NULL,
    event_name TEXT    NOT NULL, -- a ClientEvents value, e.g. "MessageDelete"
    channel_id INTEGER NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),

    PRIMARY KEY (guild_id, event_name)
) STRICT;

CREATE TABLE IF NOT EXISTS Messages (
    message_id         INTEGER NOT NULL PRIMARY KEY,
    guild_id           INTEGER NOT NULL,
    channel_id         INTEGER NOT NULL,
    user_id            INTEGER NOT NULL,
    created_at         INTEGER NOT NULL, -- unix ms

    -- 0 means payload is plaintext JSON. Above 0, it will name the key the payload is encrypted with.
    encryption_version INTEGER NOT NULL DEFAULT 0,

    -- UTF-8 JSON bytes while encryption_version is 0, cipher text above it.
    payload            BLOB    NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS Messages_created_at ON Messages (created_at);
CREATE INDEX IF NOT EXISTS Messages_guild_id ON Messages (guild_id);