const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0, 1)),
        disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS username_aliases (
        username TEXT PRIMARY KEY COLLATE NOCASE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS login_challenges (
        identifier_hash TEXT PRIMARY KEY,
        failed_count INTEGER NOT NULL DEFAULT 0,
        window_started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT,
        last_used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('file', 'text')),
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        object_key TEXT NOT NULL UNIQUE,
        directory TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(created_by, kind, directory, name)
    )`,
    `CREATE TABLE IF NOT EXISTS resource_sharing (
        resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
        public_id TEXT NOT NULL UNIQUE,
        text_format TEXT NOT NULL DEFAULT 'plain' CHECK(text_format IN ('plain', 'markdown', 'rich'))
    )`,
    `CREATE TABLE IF NOT EXISTS resource_moderation (
        resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
        blocked_at TEXT NOT NULL,
        blocked_by TEXT REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS resource_events (
        id TEXT PRIMARY KEY,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK(action IN ('upload', 'import', 'replace', 'delete')),
        kind TEXT NOT NULL CHECK(kind IN ('file', 'text')),
        public_id TEXT NOT NULL,
        directory TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        source_url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `INSERT OR IGNORE INTO resource_sharing (resource_id, public_id, text_format)
        SELECT id, 'pub_' || lower(hex(randomblob(16))), 'plain' FROM resources`,
    `INSERT OR IGNORE INTO resource_events
        (id, created_by, resource_id, action, kind, public_id, directory,
            name, version, source_url, created_at)
        SELECT 'evt_initial_' || resources.id, resources.created_by, resources.id,
            'upload', resources.kind, sharing.public_id, resources.directory,
            resources.name, resources.version, NULL, resources.created_at
        FROM resources
        JOIN resource_sharing AS sharing ON sharing.resource_id = resources.id
        WHERE NOT EXISTS (
            SELECT 1 FROM resource_events
            WHERE resource_events.resource_id = resources.id
                AND resource_events.action IN ('upload', 'import')
        )`,
    `INSERT OR IGNORE INTO username_aliases (username, user_id)
        SELECT administrator.username, administrator.id
        FROM users AS administrator
        WHERE administrator.role = 'admin'
            AND administrator.username <> 'admin' COLLATE NOCASE
            AND NOT EXISTS (
                SELECT 1 FROM users AS reserved
                WHERE reserved.username = 'admin' COLLATE NOCASE
                    AND reserved.role <> 'admin'
            )`,
    `UPDATE users
        SET username = 'admin'
        WHERE role = 'admin'
            AND username <> 'admin' COLLATE NOCASE
            AND NOT EXISTS (
                SELECT 1 FROM users AS reserved
                WHERE reserved.username = 'admin' COLLATE NOCASE
                    AND reserved.role <> 'admin'
            )`,
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_login_challenges_updated_at ON login_challenges(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_resources_owner_kind ON resources(created_by, kind, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_resources_moderation ON resource_moderation(blocked_at DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_public_id ON resource_sharing(public_id)",
    "CREATE INDEX IF NOT EXISTS idx_resource_events_owner_time ON resource_events(created_by, created_at DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_single_admin ON users(role) WHERE role = 'admin'",
    `CREATE TRIGGER IF NOT EXISTS users_updated_at
        AFTER UPDATE ON users
        BEGIN
            UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,
    `CREATE TRIGGER IF NOT EXISTS resources_updated_at
        AFTER UPDATE ON resources
        BEGIN
            UPDATE resources SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,
];

const schemaStates = new WeakMap();

export async function ensureSchema(database) {
    if (!database) {
        throw new Error("D1 binding DB is missing");
    }
    if (!schemaStates.has(database)) {
        const initialization = database.batch(
            SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)),
        ).catch((error) => {
            schemaStates.delete(database);
            throw error;
        });
        schemaStates.set(database, initialization);
    }
    await schemaStates.get(database);
}
