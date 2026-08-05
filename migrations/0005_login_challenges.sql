CREATE TABLE IF NOT EXISTS login_challenges (
    identifier_hash TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_challenges_updated_at
    ON login_challenges(updated_at);
