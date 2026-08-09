import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function schemas() {
    return Promise.all([
        readFile(new URL("../src/schema.js", import.meta.url), "utf8"),
        readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"),
    ]);
}

test("unreleased D1 schema is delivered as one initial migration", async () => {
    const files = (await readdir(new URL("../migrations/", import.meta.url)))
        .filter((file) => file.endsWith(".sql"));
    assert.deepEqual(files, ["0001_initial.sql"]);
});

test("initial D1 schema contains every application table and index", async () => {
    const [runtime, initial] = await schemas();
    const expected = [
        "CREATE TABLE IF NOT EXISTS users",
        "must_change_password",
        "CREATE TABLE IF NOT EXISTS username_aliases",
        "CREATE TABLE IF NOT EXISTS sessions",
        "CREATE TABLE IF NOT EXISTS refresh_sessions",
        "CREATE TABLE IF NOT EXISTS login_challenges",
        "CREATE TABLE IF NOT EXISTS api_keys",
        "CREATE TABLE IF NOT EXISTS resources",
        "CREATE TABLE IF NOT EXISTS resource_sharing",
        "CREATE TABLE IF NOT EXISTS resource_hashes",
        "CREATE TABLE IF NOT EXISTS resource_moderation",
        "CREATE TABLE IF NOT EXISTS resource_events",
        "CREATE TABLE IF NOT EXISTS settings",
        "UNIQUE(created_by, kind, directory, name)",
        "idx_single_admin",
        "idx_refresh_sessions_user_id",
        "idx_login_challenges_updated_at",
        "idx_resource_hashes_owner_md5",
        "idx_resources_moderation",
        "idx_resources_public_id",
        "idx_resource_events_owner_time",
    ];
    for (const sql of [runtime, initial]) {
        for (const value of expected) assert.ok(sql.includes(value), `schema must include ${value}`);
    }
    assert.match(initial, /version INTEGER NOT NULL DEFAULT 0/i);
    assert.doesNotMatch(initial, /ALTER TABLE|DROP TABLE|INSERT INTO resources_new/i);
});

test("login challenge schema never stores plaintext usernames or IP addresses", async () => {
    const [runtime, initial] = await schemas();
    for (const sql of [runtime, initial]) {
        const table = sql.match(/CREATE TABLE IF NOT EXISTS login_challenges[\s\S]*?\)/i)?.[0] || "";
        assert.match(table, /identifier_hash TEXT PRIMARY KEY/i);
        assert.match(table, /failed_count INTEGER NOT NULL/i);
        assert.match(table, /window_started_at TEXT NOT NULL/i);
        assert.doesNotMatch(table, /username|ip_address/i);
    }
});

test("runtime initialization retains safe legacy administrator normalization", async () => {
    const [runtime] = await schemas();
    assert.match(runtime, /INSERT OR IGNORE INTO username_aliases/i);
    assert.match(runtime, /username\s*=\s*'admin'/i);
    assert.match(runtime, /NOT EXISTS/i);
});
