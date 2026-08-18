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
            async findReusableFileByMd5(ownerId, contentMd5, size) {
                return records.find((resource) => (
                    resource.createdBy === ownerId
                    && resource.kind === "file"
                    && resource.contentMd5 === contentMd5
                    && resource.size === size
                    && !resource.blockedAt
                )) ?? null;
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
            async listForAuditPage(options) {
                const matched = records.filter((resource) => [
                    resource.name,
                    resource.directory,
                    resource.ownerUsername,
                    resource.publicId,
                ].some((value) => String(value || "").includes(options.query)));
                return {
                    items: matched.slice(options.offset, options.offset + options.pageSize),
                    total: matched.length,
                };
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
                    body: object.content,
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
    const service = createResourceService(memory.repository, memory.bucket, () => new Date("2026-08-06T12:00:00.000Z"));

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
    assert.match(resource.name, /^lake-\d{8}T\d{9}\.png$/);
    assert.equal(resource.objectKey, `users/usr_alice/file/trips/2026/${resource.name}`);
    assert.match(resource.publicId, /^[0-9a-km-zA-NP-Z]{6}$/);
    assert.equal(resource.version, 0);
    assert.equal(resource.url, `https://img.example.com/pub/${resource.publicId}?v=0`);
    assert.doesNotMatch(resource.url, /alice|trips|lake/i);
    assert.ok(memory.objects.has(resource.objectKey));
    assert.equal(memory.events[0].action, "upload");
});

test("new files and texts receive timestamped names while blank text names are generated", async () => {
    const memory = createMemoryResources();
    const service = createResourceService(
        memory.repository,
        memory.bucket,
        () => new Date("2026-08-06T04:05:06.123Z"),
    );

    const file = await service.create(alice, {
        kind: "file",
        directory: "trips",
        name: "lake.png",
        contentType: "image/png",
        content: new Uint8Array([1]),
        size: 1,
        origin: "https://img.example.com",
    });
    const text = await service.create(alice, {
        kind: "text",
        directory: "notes",
        name: "",
        textFormat: "markdown",
        contentType: "text/markdown; charset=utf-8",
        content: new TextEncoder().encode("# Note"),
        size: 6,
        origin: "https://img.example.com",
    });

    assert.equal(file.name, "lake-20260806T040506123.png");
    assert.equal(text.name, "text-20260806T040506123.md");
});

test("MD5 instant upload copies only the current user's matching object", async () => {
    const memory = createMemoryResources();
    const times = [
        new Date("2026-08-06T04:05:06.123Z"),
        new Date("2026-08-06T04:05:07.456Z"),
    ];
    const service = createResourceService(memory.repository, memory.bucket, () => times.shift());
    const source = await service.create(alice, {
        kind: "file",
        directory: "source",
        name: "lake.png",
        contentType: "image/png",
        contentMd5: "5289df737df57326fcdd22597afb1fac",
        content: new Uint8Array([1, 2, 3]),
        size: 3,
        origin: "https://img.example.com",
    });

    assert.equal(await service.instantCopy(bob, {
        directory: "copies",
        name: "lake.png",
        contentMd5: source.contentMd5,
        size: source.size,
        origin: "https://img.example.com",
    }), null);

    const copy = await service.instantCopy(alice, {
        directory: "copies",
        name: "lake.png",
        contentMd5: source.contentMd5,
        size: source.size,
        origin: "https://img.example.com",
    });

    assert.notEqual(copy.id, source.id);
    assert.notEqual(copy.objectKey, source.objectKey);
    assert.equal(copy.name, "lake-20260806T040507456.png");
    assert.deepEqual(memory.objects.get(copy.objectKey).content, new Uint8Array([1, 2, 3]));
    assert.equal(memory.records.length, 2);
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

    assert.match(resource.name, /^hello-\d{8}T\d{9}\.txt$/);
    assert.equal(resource.objectKey, `users/usr_alice/text/notes/${resource.name}`);
    assert.equal(resource.textFormat, "plain");
});

test("a duplicate upload cannot overwrite or delete the existing R2 object", async () => {
    const memory = createMemoryResources();
    const now = new Date("2026-08-06T04:05:06.123Z");
    const objectKey = "users/usr_alice/file/trips/lake-20260806T040506123.png";
    memory.records.push({ id: "existing", createdBy: alice.id, objectKey });
    memory.objects.set(objectKey, { content: "original" });
    const service = createResourceService(memory.repository, memory.bucket, () => now);

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
        version: 0,
        publicId: "0123456789abcdef0123456789abcdef",
    });
    const service = createResourceService(memory.repository, memory.bucket);

    const updated = await service.replace(alice, "one", {
        content: new Uint8Array([9]),
        contentType: "image/webp",
        size: 1,
        origin: "https://img.example.com",
    });

    assert.equal(updated.objectKey, "users/usr_alice/file/trips/lake.png");
    assert.equal(updated.version, 1);
    assert.equal(updated.url, "https://img.example.com/pub/0123456789abcdef0123456789abcdef?v=1");
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
        version: 1754481600000,
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
        version: 1754481600000,
        publicId: "22222222222222222222222222222222",
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
        version: 0,
        publicId: "11111111111111111111111111111111",
    });
    const service = createResourceService(memory.repository, memory.bucket);

    await assert.rejects(service.listForAudit(alice, "https://img.example.com"), /administrator/i);
    const resources = await service.listForAudit(admin, "https://img.example.com");

    assert.equal(resources[0].ownerUsername, "alice");
    assert.equal(resources[0].url, "https://img.example.com/pub/11111111111111111111111111111111?v=0");
});

test("administrator content audit is searched and paginated", async () => {
    const memory = createMemoryResources();
    memory.records.push(
        {
            id: "one",
            createdBy: alice.id,
            ownerUsername: alice.username,
            name: "first-note.md",
            kind: "text",
            publicId: "11111111111111111111111111111111",
            version: 1,
        },
        {
            id: "two",
            createdBy: alice.id,
            ownerUsername: alice.username,
            name: "second-note.md",
            kind: "text",
            publicId: "22222222222222222222222222222222",
            version: 1,
        },
    );
    const service = createResourceService(memory.repository, memory.bucket);

    const result = await service.listForAuditPage(admin, "https://img.example.com", {
        page: "2",
        pageSize: "1",
        query: " note ",
    });

    assert.equal(result.items[0].name, "second-note.md");
    assert.equal(result.items[0].url, "https://img.example.com/pub/22222222222222222222222222222222?v=1");
    assert.deepEqual(result.pagination, { page: 2, pageSize: 1, total: 2, totalPages: 2 });
});

test("upload history remains available as a time-ordered activity stream", async () => {
    const memory = createMemoryResources();
    const service = createResourceService(memory.repository, memory.bucket, () => new Date("2026-08-06T12:00:00.000Z"));
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
    assert.equal(history[0].url, `https://img.example.com/pub/${created.publicId}?v=0`);
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
        version: 1754481600000,
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
