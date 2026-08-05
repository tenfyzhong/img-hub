CREATE TABLE IF NOT EXISTS username_aliases (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO username_aliases (username, user_id)
SELECT administrator.username, administrator.id
FROM users AS administrator
WHERE administrator.role = 'admin'
    AND administrator.username <> 'admin' COLLATE NOCASE
    AND NOT EXISTS (
        SELECT 1 FROM users AS reserved
        WHERE reserved.username = 'admin' COLLATE NOCASE
            AND reserved.role <> 'admin'
    );

UPDATE users
SET username = 'admin'
WHERE role = 'admin'
    AND username <> 'admin' COLLATE NOCASE
    AND NOT EXISTS (
        SELECT 1 FROM users AS reserved
        WHERE reserved.username = 'admin' COLLATE NOCASE
            AND reserved.role <> 'admin'
    );
