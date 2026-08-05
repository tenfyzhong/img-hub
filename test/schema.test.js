import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("D1 schema records users, sessions, resource ownership and versions", async () => {
    const sql = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");

    for (const expected of [
        "CREATE TABLE IF NOT EXISTS users",
        "must_change_password",
        "CREATE TABLE IF NOT EXISTS sessions",
        "CREATE TABLE IF NOT EXISTS resources",
        "created_by",
        "version INTEGER",
        "UNIQUE(created_by, kind, directory, name)",
        "idx_single_admin",
        "CREATE TABLE IF NOT EXISTS api_keys",
        "token_hash",
        "last_used_at",
        "revoked_at",
    ]) {
        assert.ok(sql.includes(expected), `schema must include ${expected}`);
    }
});

test("D1 migrations preserve moderation audit tombstones", async () => {
    const [runtime, migration] = await Promise.all([
        readFile(new URL("../src/schema.js", import.meta.url), "utf8"),
        readFile(new URL("../migrations/0002_moderation.sql", import.meta.url), "utf8"),
    ]);

    for (const expected of [
        "CREATE TABLE IF NOT EXISTS resource_moderation",
        "blocked_at",
        "blocked_by",
        "idx_resources_moderation",
    ]) {
        assert.match(runtime, new RegExp(expected));
        assert.match(migration, new RegExp(expected));
    }
    assert.doesNotMatch(migration, /ALTER TABLE/i);
});

test("existing administrators are safely normalized to the fixed admin username", async () => {
    const [runtime, migration] = await Promise.all([
        readFile(new URL("../src/schema.js", import.meta.url), "utf8"),
        readFile(new URL("../migrations/0003_admin_username.sql", import.meta.url), "utf8"),
    ]);

    for (const sql of [runtime, migration]) {
        assert.match(sql, /CREATE TABLE IF NOT EXISTS username_aliases/i);
        assert.match(sql, /INSERT OR IGNORE INTO username_aliases/i);
        assert.match(sql, /username\s*=\s*'admin'/i);
        assert.match(sql, /NOT EXISTS/i);
    }
});

test("resources gain opaque public IDs, text formats, and durable activity events", async () => {
    const [runtime, migration] = await Promise.all([
        readFile(new URL("../src/schema.js", import.meta.url), "utf8"),
        readFile(new URL("../migrations/0004_resource_sharing.sql", import.meta.url), "utf8"),
    ]);

    for (const sql of [runtime, migration]) {
        assert.match(sql, /CREATE TABLE IF NOT EXISTS resource_sharing/i);
        assert.match(sql, /public_id/i);
        assert.match(sql, /text_format/i);
        assert.match(sql, /CREATE TABLE IF NOT EXISTS resource_events/i);
        assert.match(sql, /INSERT OR IGNORE INTO resource_events/i);
        assert.match(sql, /idx_resources_public_id/i);
    }
    assert.match(migration, /randomblob/i);
    assert.doesNotMatch(migration, /ALTER TABLE/i);
});

test("login challenge counters exist in runtime schema and deploy-time migrations", async () => {
    const [runtime, migration] = await Promise.all([
        readFile(new URL("../src/schema.js", import.meta.url), "utf8"),
        readFile(new URL("../migrations/0005_login_challenges.sql", import.meta.url), "utf8"),
    ]);

    for (const sql of [runtime, migration]) {
        assert.match(sql, /CREATE TABLE IF NOT EXISTS login_challenges/i);
        assert.match(sql, /identifier_hash TEXT PRIMARY KEY/i);
        assert.match(sql, /failed_count INTEGER NOT NULL/i);
        assert.match(sql, /window_started_at TEXT NOT NULL/i);
        const table = sql.match(/CREATE TABLE IF NOT EXISTS login_challenges[\s\S]*?\)/i)?.[0] || "";
        assert.doesNotMatch(table, /username|ip_address/i);
    }
});
