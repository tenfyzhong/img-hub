CREATE TABLE IF NOT EXISTS resource_moderation (
    resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    blocked_at TEXT NOT NULL,
    blocked_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_resources_moderation
ON resource_moderation(blocked_at DESC);
