import assert from "node:assert/strict";
import test from "node:test";

import { createApiKeyService } from "../src/api-key-service.js";

function createMemoryApiKeys() {
    const records = [];
    return {
        records,
        repository: {
            async create(record) {
                records.push({ ...record });
                return record;
            },
            async countActiveByOwner(ownerId) {
                return records.filter((record) => record.userId === ownerId && !record.revokedAt).length;
            },
            async listByOwner(ownerId) {
                return records.filter((record) => record.userId === ownerId);
            },
            async findById(id) {
                return records.find((record) => record.id === id) ?? null;
            },
            async revoke(id) {
                records.find((record) => record.id === id).revokedAt = new Date().toISOString();
            },
            async findUserByTokenHash(tokenHash) {
                const record = records.find((candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt);
                return record ? { id: record.userId, username: "alice", role: "user", mustChangePassword: false } : null;
            },
        },
    };
}

const alice = { id: "usr_alice", username: "alice", role: "user", mustChangePassword: false };
const bob = { id: "usr_bob", username: "bob", role: "user", mustChangePassword: false };

test("creates an API key while storing only its hash", async () => {
    const memory = createMemoryApiKeys();
    const service = createApiKeyService(memory.repository);

    const created = await service.create(alice, "agent laptop", 30);

    assert.match(created.token, /^imh_[A-Za-z0-9_-]{40,}$/);
    assert.equal(created.apiKey.name, "agent laptop");
    assert.equal(created.apiKey.userId, alice.id);
    assert.equal(created.apiKey.expiresAt.slice(0, 10), new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    assert.notEqual(memory.records[0].tokenHash, created.token);
    assert.equal("tokenHash" in created.apiKey, false);
});

test("lists metadata without returning token hashes", async () => {
    const memory = createMemoryApiKeys();
    const service = createApiKeyService(memory.repository);
    await service.create(alice, "automation");

    const listed = await service.list(alice);

    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, "automation");
    assert.equal("tokenHash" in listed[0], false);
});

test("authenticates a valid key and rejects malformed or revoked keys", async () => {
    const memory = createMemoryApiKeys();
    const service = createApiKeyService(memory.repository);
    const created = await service.create(alice, "automation");

    assert.equal((await service.authenticate(created.token)).id, alice.id);
    assert.equal(await service.authenticate("not-a-key"), null);
    await service.revoke(alice, created.apiKey.id);
    assert.equal(await service.authenticate(created.token), null);
});

test("only the owner can revoke an API key", async () => {
    const memory = createMemoryApiKeys();
    const service = createApiKeyService(memory.repository);
    const created = await service.create(alice, "automation");

    await assert.rejects(service.revoke(bob, created.apiKey.id), /owner/i);
    await service.revoke(alice, created.apiKey.id);
    assert.ok(memory.records[0].revokedAt);
});

test("temporary-password users cannot create API keys", async () => {
    const memory = createMemoryApiKeys();
    const service = createApiKeyService(memory.repository);

    await assert.rejects(service.create({ ...alice, mustChangePassword: true }, "automation"), /change your password/i);
});

test("validates API key name, expiry, and active-key limit", async () => {
    const memory = createMemoryApiKeys();
    const service = createApiKeyService(memory.repository);

    await assert.rejects(service.create(alice, "", 30), /name/i);
    await assert.rejects(service.create(alice, "automation", 366), /expiry/i);
    for (let index = 0; index < 20; index += 1) {
        await service.create(alice, `key ${index}`);
    }
    await assert.rejects(service.create(alice, "one too many"), /20 active/i);
});
