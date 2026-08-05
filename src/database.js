function mapUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        passwordHash: row.password_hash,
        role: row.role,
        mustChangePassword: Boolean(row.must_change_password),
        disabled: Boolean(row.disabled),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapResource(row) {
    if (!row) return null;
    return {
        id: row.id,
        kind: row.kind,
        createdBy: row.created_by,
        objectKey: row.object_key,
        publicId: row.public_id,
        directory: row.directory,
        name: row.name,
        contentType: row.content_type,
        textFormat: row.text_format || "plain",
        size: Number(row.size),
        version: Number(row.version),
        blockedAt: row.blocked_at || null,
        blockedBy: row.blocked_by || null,
        ownerUsername: row.owner_username,
        blockedByUsername: row.blocked_by_username || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapResourceEvent(row) {
    if (!row) return null;
    return {
        id: row.id,
        createdBy: row.created_by,
        resourceId: row.resource_id,
        action: row.action,
        kind: row.kind,
        publicId: row.public_id,
        directory: row.directory,
        name: row.name,
        version: Number(row.version),
        sourceUrl: row.source_url || null,
        resourceDeleted: !row.live_resource_id,
        createdAt: row.created_at,
    };
}

function mapApiKey(row) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        prefix: row.prefix,
        tokenHash: row.token_hash,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
    };
}

function mapLoginChallenge(row) {
    if (!row) return null;
    return {
        identifierHash: row.identifier_hash,
        failedCount: Number(row.failed_count),
        windowStartedAt: row.window_started_at,
        updatedAt: row.updated_at,
    };
}

export function createRepositories(database) {
    const users = {
        async create(user) {
            await database.prepare(`INSERT INTO users
                (id, username, password_hash, role, must_change_password, disabled)
                VALUES (?, ?, ?, ?, ?, ?)`)
                .bind(
                    user.id,
                    user.username,
                    user.passwordHash,
                    user.role,
                    user.mustChangePassword ? 1 : 0,
                    user.disabled ? 1 : 0,
                ).run();
            return user;
        },
        async findById(id) {
            return mapUser(await database.prepare("SELECT * FROM users WHERE id = ?").bind(id).first());
        },
        async findByUsername(username) {
            return mapUser(await database.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
                .bind(username).first());
        },
        async isUsernameReserved(username) {
            return Boolean(await database.prepare(`SELECT 1 FROM username_aliases
                WHERE username = ? COLLATE NOCASE`).bind(username).first());
        },
        async updatePassword(id, passwordHash, mustChangePassword) {
            await database.prepare(`UPDATE users
                SET password_hash = ?, must_change_password = ? WHERE id = ?`)
                .bind(passwordHash, mustChangePassword ? 1 : 0, id).run();
        },
        async deleteSessions(id, exceptTokenHash = null) {
            if (exceptTokenHash) {
                await database.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
                    .bind(id, exceptTokenHash).run();
            } else {
                await database.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
            }
        },
        async list() {
            const result = await database.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
            return result.results.map(mapUser);
        },
        async count() {
            const row = await database.prepare("SELECT COUNT(*) AS count FROM users").first();
            return Number(row?.count || 0);
        },
        async setDisabled(id, disabled) {
            await database.prepare("UPDATE users SET disabled = ? WHERE id = ?")
                .bind(disabled ? 1 : 0, id).run();
            return this.findById(id);
        },
    };

    const sessions = {
        async create(session) {
            await database.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at)
                VALUES (?, ?, ?)`)
                .bind(session.tokenHash, session.userId, session.expiresAt).run();
        },
        async findUserByTokenHash(tokenHash) {
            const row = await database.prepare(`SELECT users.* FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ? AND datetime(sessions.expires_at) > datetime('now')`)
                .bind(tokenHash).first();
            return mapUser(row);
        },
        async delete(tokenHash) {
            await database.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
        },
        async cleanup() {
            await database.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
        },
    };

    const loginChallenges = {
        async find(identifierHash) {
            return mapLoginChallenge(await database.prepare(
                "SELECT * FROM login_challenges WHERE identifier_hash = ?",
            ).bind(identifierHash).first());
        },
        async recordFailure(identifierHash, now, cutoff) {
            const row = await database.prepare(`INSERT INTO login_challenges
                (identifier_hash, failed_count, window_started_at, updated_at)
                VALUES (?, 1, ?, ?)
                ON CONFLICT(identifier_hash) DO UPDATE SET
                    failed_count = CASE
                        WHEN login_challenges.window_started_at <= ? THEN 1
                        ELSE login_challenges.failed_count + 1
                    END,
                    window_started_at = CASE
                        WHEN login_challenges.window_started_at <= ? THEN excluded.window_started_at
                        ELSE login_challenges.window_started_at
                    END,
                    updated_at = excluded.updated_at
                RETURNING *`).bind(identifierHash, now, now, cutoff, cutoff).first();
            return mapLoginChallenge(row);
        },
        async delete(identifierHash) {
            await database.prepare("DELETE FROM login_challenges WHERE identifier_hash = ?")
                .bind(identifierHash).run();
        },
        async deleteExpired(cutoff) {
            await database.prepare("DELETE FROM login_challenges WHERE updated_at <= ?")
                .bind(cutoff).run();
        },
    };

    const apiKeys = {
        async create(apiKey) {
            await database.prepare(`INSERT INTO api_keys
                (id, user_id, name, prefix, token_hash, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
                .bind(
                    apiKey.id,
                    apiKey.userId,
                    apiKey.name,
                    apiKey.prefix,
                    apiKey.tokenHash,
                    apiKey.expiresAt,
                ).run();
            return apiKey;
        },
        async countActiveByOwner(ownerId) {
            const row = await database.prepare(`SELECT COUNT(*) AS count FROM api_keys
                WHERE user_id = ? AND revoked_at IS NULL
                    AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`)
                .bind(ownerId).first();
            return Number(row?.count || 0);
        },
        async listByOwner(ownerId) {
            const result = await database.prepare(`SELECT * FROM api_keys
                WHERE user_id = ? ORDER BY created_at DESC`).bind(ownerId).all();
            return result.results.map(mapApiKey);
        },
        async findById(id) {
            return mapApiKey(await database.prepare("SELECT * FROM api_keys WHERE id = ?").bind(id).first());
        },
        async revoke(id) {
            await database.prepare(`UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP
                WHERE id = ? AND revoked_at IS NULL`).bind(id).run();
        },
        async revokeAllByOwner(ownerId) {
            await database.prepare(`UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND revoked_at IS NULL`).bind(ownerId).run();
        },
        async findUserByTokenHash(tokenHash) {
            const row = await database.prepare(`SELECT users.* FROM api_keys
                JOIN users ON users.id = api_keys.user_id
                WHERE api_keys.token_hash = ? AND api_keys.revoked_at IS NULL
                    AND (api_keys.expires_at IS NULL OR datetime(api_keys.expires_at) > datetime('now'))
                    AND users.disabled = 0`).bind(tokenHash).first();
            if (row) {
                await database.prepare(`UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP
                    WHERE token_hash = ?`).bind(tokenHash).run();
            }
            return mapUser(row);
        },
    };

    const resources = {
        async create(resource) {
            await database.batch([
                database.prepare(`INSERT INTO resources
                    (id, kind, created_by, object_key, directory, name, content_type, size, version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
                    resource.id,
                    resource.kind,
                    resource.createdBy,
                    resource.objectKey,
                    resource.directory,
                    resource.name,
                    resource.contentType,
                    resource.size,
                    resource.version,
                ),
                database.prepare(`INSERT INTO resource_sharing (resource_id, public_id, text_format)
                    VALUES (?, ?, ?)`).bind(resource.id, resource.publicId, resource.textFormat),
            ]);
            return resource;
        },
        async findById(id) {
            return mapResource(await database.prepare(`SELECT resources.*,
                    sharing.public_id, sharing.text_format,
                    moderation.blocked_at, moderation.blocked_by
                FROM resources
                JOIN resource_sharing AS sharing ON sharing.resource_id = resources.id
                LEFT JOIN resource_moderation AS moderation
                    ON moderation.resource_id = resources.id
                WHERE resources.id = ?`).bind(id).first());
        },
        async findPublic(kind, username, directory, name) {
            const row = await database.prepare(`SELECT resources.*,
                    sharing.public_id, sharing.text_format
                FROM resources
                JOIN resource_sharing AS sharing ON sharing.resource_id = resources.id
                JOIN users ON users.id = resources.created_by
                WHERE resources.kind = ?
                    AND (users.username = ? COLLATE NOCASE OR EXISTS (
                        SELECT 1 FROM username_aliases
                        WHERE username_aliases.user_id = users.id
                            AND username_aliases.username = ? COLLATE NOCASE
                    ))
                    AND resources.directory = ? AND resources.name = ?
                    AND NOT EXISTS (SELECT 1 FROM resource_moderation
                        WHERE resource_id = resources.id)
                    AND users.disabled = 0`)
                .bind(kind, username, username, directory, name).first();
            return mapResource(row);
        },
        async findPublicById(kind, publicId) {
            const row = await database.prepare(`SELECT resources.*,
                    sharing.public_id, sharing.text_format
                FROM resources
                JOIN resource_sharing AS sharing ON sharing.resource_id = resources.id
                JOIN users ON users.id = resources.created_by
                WHERE resources.kind = ? AND sharing.public_id = ?
                    AND NOT EXISTS (SELECT 1 FROM resource_moderation
                        WHERE resource_id = resources.id)
                    AND users.disabled = 0`).bind(kind, publicId).first();
            return mapResource(row);
        },
        async listByOwner(ownerId, kind) {
            const query = kind
                ? database.prepare(`SELECT resources.*, sharing.public_id, sharing.text_format
                    FROM resources
                    JOIN resource_sharing AS sharing ON sharing.resource_id = resources.id
                    WHERE created_by = ? AND kind = ?
                        AND NOT EXISTS (SELECT 1 FROM resource_moderation
                            WHERE resource_id = resources.id)
                    ORDER BY updated_at DESC`).bind(ownerId, kind)
                : database.prepare(`SELECT resources.*, sharing.public_id, sharing.text_format
                    FROM resources
                    JOIN resource_sharing AS sharing ON sharing.resource_id = resources.id
                    WHERE created_by = ?
                        AND NOT EXISTS (SELECT 1 FROM resource_moderation
                            WHERE resource_id = resources.id)
                    ORDER BY updated_at DESC`).bind(ownerId);
            const result = await query.all();
            return result.results.map(mapResource);
        },
        async listForAudit() {
            const result = await database.prepare(`SELECT resources.*,
                    sharing.public_id, sharing.text_format,
                    moderation.blocked_at, moderation.blocked_by,
                    owner.username AS owner_username,
                    moderator.username AS blocked_by_username
                FROM resources
                JOIN resource_sharing AS sharing ON sharing.resource_id = resources.id
                JOIN users AS owner ON owner.id = resources.created_by
                LEFT JOIN resource_moderation AS moderation
                    ON moderation.resource_id = resources.id
                LEFT JOIN users AS moderator ON moderator.id = moderation.blocked_by
                ORDER BY resources.updated_at DESC`).all();
            return result.results.map(mapResource);
        },
        async block(id, actorId, blockedAt) {
            await database.prepare(`INSERT OR IGNORE INTO resource_moderation
                (resource_id, blocked_at, blocked_by) VALUES (?, ?, ?)`)
                .bind(id, blockedAt, actorId).run();
            return this.findById(id);
        },
        async updateContent(id, attributes) {
            await database.batch([
                database.prepare(`UPDATE resources
                    SET content_type = ?, size = ?, version = ? WHERE id = ?`).bind(
                    attributes.contentType,
                    attributes.size,
                    attributes.version,
                    id,
                ),
                database.prepare(`UPDATE resource_sharing SET text_format = ? WHERE resource_id = ?`)
                    .bind(attributes.textFormat, id),
            ]);
            return this.findById(id);
        },
        async addEvent(event) {
            await database.prepare(`INSERT INTO resource_events
                (id, created_by, resource_id, action, kind, public_id, directory,
                    name, version, source_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
                event.id,
                event.createdBy,
                event.resourceId,
                event.action,
                event.kind,
                event.publicId,
                event.directory,
                event.name,
                event.version,
                event.sourceUrl ?? null,
                event.createdAt,
            ).run();
            return event;
        },
        async listEventsByOwner(ownerId) {
            const result = await database.prepare(`SELECT resource_events.*,
                    resources.id AS live_resource_id
                FROM resource_events
                LEFT JOIN resources ON resources.id = resource_events.resource_id
                WHERE resource_events.created_by = ?
                ORDER BY resource_events.created_at ASC, resource_events.id ASC`)
                .bind(ownerId).all();
            return result.results.map(mapResourceEvent);
        },
        async delete(id) {
            await database.prepare("DELETE FROM resources WHERE id = ?").bind(id).run();
        },
    };

    const settings = {
        async get(key) {
            const row = await database.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
            return row?.value ?? null;
        },
        async set(key, value) {
            await database.prepare(`INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
                .bind(key, String(value)).run();
        },
    };

    return { users, sessions, loginChallenges, apiKeys, resources, settings };
}
