CREATE TABLE IF NOT EXISTS resource_sharing (
    resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    public_id TEXT NOT NULL UNIQUE,
    text_format TEXT NOT NULL DEFAULT 'plain' CHECK(text_format IN ('plain', 'markdown', 'rich'))
);

INSERT OR IGNORE INTO resource_sharing (resource_id, public_id, text_format)
SELECT id, 'pub_' || lower(hex(randomblob(16))), 'plain' FROM resources;

CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_public_id ON resource_sharing(public_id);

CREATE TABLE IF NOT EXISTS resource_events (
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
);

CREATE INDEX IF NOT EXISTS idx_resource_events_owner_time
    ON resource_events(created_by, created_at DESC);

INSERT OR IGNORE INTO resource_events
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
);
