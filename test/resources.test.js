import assert from "node:assert/strict";
import test from "node:test";

import { createResourceService } from "../src/resource-service.js";

function createMemoryResources() {
    const records = [];
    const events = [];
    const objects = new Map();
    return {
        records,
        events,
        objects,
        repository: {
            async create(resource) {
                if (records.some((existing) => existing.objectKey === resource.objectKey)) {
                    throw new Error("UNIQUE constraint failed: resources.object_key");
                }
                records.push(resource);
                return resource;
            },
            async findById(id) {
                return records.find((resource) => resource.id === id) ?? null;
            },
            async listByOwner(ownerId, kind) {
                return records.filter((resource) => (
                    resource.createdBy === ownerId
                    && !resource.blockedAt
                    && (!kind || resource.kind === kind)
                ));
            },
            async listForAudit() {
                return records;
            },
            async addEvent(event) {
                events.push(event);
                return event;
            },
            async listEventsByOwner(ownerId) {
                return events.filter((event) => event.createdBy === ownerId);
            },
            async block(id, actorId, blockedAt) {
                const resource = records.find((candidate) => candidate.id === id);
                Object.assign(resource, { blockedBy: actorId, blockedAt });
                return resource;
            },
            async updateContent(id, attributes) {
                const resource = records.find((candidate) => candidate.id === id);
                Object.assign(resource, attributes);
                return resource;
            },
            async delete(id) {
                const index = records.findIndex((resource) => resource.id === id);
                records.splice(index, 1);
            },
        },
        bucket: {
            async put(key, content, options) {
                objects.set(key, { content, options });
            },
            async delete(key) {
                objects.delete(key);
            },
            async get(key) {
                const object = objects.get(key);
                if (!object) return null;
                return {
                    async text() {
                        return typeof object.content === "string"
                            ? object.content
                            : new TextDecoder().decode(object.content);
                    },
                };
            },
        },
    };
}

const alice = { id: "usr_alice", username: "alice", role: "user", mustChangePassword: false };
const bob = { id: "usr_bob", username: "bob", role: "user", mustChangePassword: false };
const admin = { id: "usr_admin", username: "admin", role: "admin", mustChangePassword: false };

test("uploads are stored under the creator's isolated file root", async () => {
    const memory = createMemoryResources();
    const service = createResourceService(memory.repository, memory.bucket);

    const resource = await service.create(alice, {
        kind: "file",
        directory: "trips/2026",
        name: "lake.png",
        contentType: "image/png",
        content: new Uint8Array([1, 2, 3]),
        size: 3,
        origin: "https://img.example.com",
    });

    assert.equal(resource.createdBy, alice.id);
    assert.equal(resource.objectKey, "users/usr_alice/file/trips/2026/lake.png");
    assert.match(resource.publicId, /^pub_[a-f0-9]{32}$/);
    assert.equal(resource.url, `https://img.example.com/file/${resource.publicId}?v=1`);
    assert.doesNotMatch(resource.url, /alice|trips|lake/i);
    assert.ok(memory.objects.has(resource.objectKey));
    assert.equal(memory.events[0].action, "upload");
});

test("text is stored under the creator's text root", async () => {
    const memory = createMemoryResources();
    const service = createResourceService(memory.repository, memory.bucket);
    const resource = await service.create(alice, {
        kind: "text",
        directory: "notes",
        name: "hello.txt",
        contentType: "text/plain; charset=utf-8",
        content: "hello",
        size: 5,
        origin: "https://img.example.com",
    });

    assert.equal(resource.objectKey, "users/usr_alice/text/notes/hello.txt");
    assert.equal(resource.textFormat, "plain");
});

test("a duplicate upload cannot overwrite or delete the existing R2 object", async () => {
    const memory = createMemoryResources();
    const objectKey = "users/usr_alice/file/trips/lake.png";
    memory.records.push({ id: "existing", createdBy: alice.id, objectKey });
    memory.objects.set(objectKey, { content: "original" });
    const service = createResourceService(memory.repository, memory.bucket);

    await assert.rejects(service.create(alice, {
        kind: "file",
        directory: "trips",
        name: "lake.png",
        contentType: "image/png",
        content: new Uint8Array([9]),
        size: 1,
        origin: "https://img.example.com",
    }), /already exists/i);

    assert.equal(memory.objects.get(objectKey).content, "original");
    assert.equal(memory.records.length, 1);
});

test("users only list their own resources", async () => {
    const memory = createMemoryResources();
    memory.records.push(
        { id: "one", createdBy: alice.id, kind: "file" },
        { id: "two", createdBy: bob.id, kind: "file" },
    );
    const service = createResourceService(memory.repository, memory.bucket);

    assert.deepEqual(await service.list(alice, "file"), [memory.records[0]]);
});

test("only the creator can delete a resource", async () => {
    const memory = createMemoryResources();
    memory.records.push({ id: "one", createdBy: alice.id, objectKey: "users/usr_alice/file/x.png" });
    memory.objects.set("users/usr_alice/file/x.png", {});
    const service = createResourceService(memory.repository, memory.bucket);

    await assert.rejects(service.delete(bob, "one"), /owner/i);
    await service.delete(alice, "one");
    assert.equal(memory.records.length, 0);
    assert.equal(memory.objects.size, 0);
});

test("replacement keeps the object path and increments the cache version", async () => {
    const memory = createMemoryResources();
    memory.records.push({
        id: "one",
        createdBy: alice.id,
        objectKey: "users/usr_alice/file/trips/lake.png",
        kind: "file",
        directory: "trips",
        name: "lake.png",
        contentType: "image/png",
        version: 3,
        publicId: "pub_0123456789abcdef0123456789abcdef",
    });
    const service = createResourceService(memory.repository, memory.bucket);

    const updated = await service.replace(alice, "one", {
        content: new Uint8Array([9]),
        contentType: "image/webp",
        size: 1,
        origin: "https://img.example.com",
    });

    assert.equal(updated.objectKey, "users/usr_alice/file/trips/lake.png");
    assert.equal(updated.version, 4);
    assert.equal(updated.url, "https://img.example.com/file/pub_0123456789abcdef0123456789abcdef?v=4");
    assert.equal(memory.events.at(-1).action, "replace");
});

test("replacement cannot change a resource between file and text", async () => {
    const memory = createMemoryResources();
    memory.records.push({
        id: "one",
        createdBy: alice.id,
        objectKey: "users/usr_alice/file/lake.png",
        kind: "file",
        directory: "",
        name: "lake.png",
        contentType: "image/png",
        version: 1,
    });
    const service = createResourceService(memory.repository, memory.bucket);

    await assert.rejects(service.replace(alice, "one", {
        kind: "text",
        content: "not an image",
        contentType: "text/plain",
        size: 12,
        origin: "https://img.example.com",
    }), /resource type/i);
});

test("only the owner can load original text for editing", async () => {
    const memory = createMemoryResources();
    const resource = {
        id: "text-one",
        createdBy: alice.id,
        objectKey: "users/usr_alice/text/notes/readme.md",
        kind: "text",
        directory: "notes",
        name: "readme.md",
        contentType: "text/markdown; charset=utf-8",
        textFormat: "markdown",
        version: 1,
        publicId: "pub_22222222222222222222222222222222",
    };
    memory.records.push(resource);
    memory.objects.set(resource.objectKey, { content: "# Original" });
    const service = createResourceService(memory.repository, memory.bucket);

    await assert.rejects(service.getContent(bob, resource.id), /owner/i);
    assert.deepEqual(await service.getContent(alice, resource.id), {
        resource,
        content: "# Original",
    });
});

test("rich text is sanitized before storage and again before editor playback", async () => {
    const memory = createMemoryResources();
    const service = createResourceService(memory.repository, memory.bucket);
    const unsafe = '<p>Hello<img src=x onerror=alert(1)><script>alert(1)</script></p>';
    const created = await service.create(alice, {
        kind: "text",
        directory: "notes",
        name: "safe.html",
        contentType: "text/html; charset=utf-8",
        textFormat: "rich",
        content: new TextEncoder().encode(unsafe),
        size: new TextEncoder().encode(unsafe).byteLength,
        origin: "https://img.example.com",
    });

    const stored = new TextDecoder().decode(memory.objects.get(created.objectKey).content);
    assert.match(stored, /<p>Hello/);
    assert.doesNotMatch(stored, /<img|<script|onerror/i);

    memory.objects.get(created.objectKey).content = unsafe;
    const loaded = await service.getContent(alice, created.id);
    assert.doesNotMatch(loaded.content, /<img|<script|onerror/i);
});

test("users with a temporary password cannot manage content", async () => {
    const memory = createMemoryResources();
    const service = createResourceService(memory.repository, memory.bucket);
    const firstLoginUser = { ...alice, mustChangePassword: true };

    await assert.rejects(service.list(firstLoginUser), /change your password/i);
});

test("administrators audit every resource with its uploader and public link", async () => {
    const memory = createMemoryResources();
    memory.records.push({
        id: "one",
        createdBy: alice.id,
        ownerUsername: alice.username,
        objectKey: "users/usr_alice/text/review/item.txt",
        kind: "text",
        directory: "review",
        name: "item.txt",
        contentType: "text/plain; charset=utf-8",
        version: 2,
        publicId: "pub_11111111111111111111111111111111",
    });
    const service = createResourceService(memory.repository, memory.bucket);

    await assert.rejects(service.listForAudit(alice, "https://img.example.com"), /administrator/i);
    const resources = await service.listForAudit(admin, "https://img.example.com");

    assert.equal(resources[0].ownerUsername, "alice");
    assert.equal(resources[0].url, "https://img.example.com/text/pub_11111111111111111111111111111111?v=2");
});

test("upload history remains available as a time-ordered activity stream", async () => {
    const memory = createMemoryResources();
    const service = createResourceService(memory.repository, memory.bucket);
    const created = await service.create(alice, {
        kind: "file",
        directory: "archive",
        name: "history.png",
        contentType: "image/png",
        content: new Uint8Array([1]),
        size: 1,
        origin: "https://img.example.com",
    });
    await service.replace(alice, created.id, {
        content: new Uint8Array([2]),
        contentType: "image/png",
        size: 1,
        origin: "https://img.example.com",
    });
    await service.delete(alice, created.id);

    const history = await service.listHistory(alice, "https://img.example.com");
    assert.deepEqual(history.map((event) => event.action), ["upload", "replace", "delete"]);
    assert.equal(history[0].url, `https://img.example.com/file/${created.publicId}?v=1`);
    assert.equal(history[2].resourceDeleted, true);
});

test("administrator blocking deletes the source object and preserves an audit tombstone", async () => {
    const memory = createMemoryResources();
    const resource = {
        id: "one",
        createdBy: alice.id,
        ownerUsername: alice.username,
        objectKey: "users/usr_alice/file/unsafe.png",
        kind: "file",
        directory: "",
        name: "unsafe.png",
        contentType: "image/png",
        version: 1,
    };
    memory.records.push(resource);
    memory.objects.set(resource.objectKey, { content: "unsafe" });
    const service = createResourceService(memory.repository, memory.bucket);

    await assert.rejects(service.block(alice, resource.id), /administrator/i);
    const blocked = await service.block(admin, resource.id);

    assert.equal(memory.objects.has(resource.objectKey), false);
    assert.equal(blocked.blockedBy, admin.id);
    assert.ok(blocked.blockedAt);
    assert.deepEqual(await service.list(alice, "file"), []);
    await assert.rejects(service.replace(alice, resource.id, {
        content: new Uint8Array([1]),
        contentType: "image/png",
        size: 1,
        origin: "https://img.example.com",
    }), /not found/i);
    assert.equal(memory.records.length, 1);
});
