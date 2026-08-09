import assert from "node:assert/strict";
import test from "node:test";

import { servePublicResource } from "../src/public-resource.js";

function createFixture(kind) {
    const calls = { metadata: 0, object: 0, put: 0 };
    let allowed = true;
    const resource = {
        kind,
        objectKey: `users/usr_alice/${kind}/notes/item.${kind === "text" ? "txt" : "png"}`,
        name: kind === "text" ? "item.txt" : "item.png",
        contentType: kind === "text" ? "text/plain; charset=utf-8" : "image/png",
        textFormat: kind === "text" ? "plain" : undefined,
        version: 1754481600000,
        publicId: "pub_0123456789abcdef0123456789abcdef",
    };
    const stored = new Map();
    const pending = [];
    return {
        calls,
        pending,
        repository: {
            async findByPublicId() {
                calls.metadata += 1;
                return allowed ? resource : null;
            },
            async findPublicById() {
                calls.metadata += 1;
                return allowed ? resource : null;
            },
            async findPublic() {
                calls.metadata += 1;
                return allowed ? resource : null;
            },
        },
        bucket: {
            async get() {
                calls.object += 1;
                return { body: kind === "text" ? "cached text" : new Uint8Array([1, 2, 3]), etag: "etag" };
            },
            async head() {
                calls.object += 1;
                return { etag: "etag" };
            },
        },
        cache: {
            async match(request) {
                return stored.get(request.url)?.clone();
            },
            async put(request, response) {
                calls.put += 1;
                stored.set(request.url, response.clone());
            },
        },
        context: {
            waitUntil(promise) {
                pending.push(promise);
            },
        },
        route: { publicId: resource.publicId },
        deny() {
            allowed = false;
        },
    };
}

for (const kind of ["file", "text"]) {
    test(`versioned ${kind} reads check availability then use edge cache before R2`, async () => {
        const fixture = createFixture(kind);
        const url = `https://images.example.com/${fixture.route.publicId}?v=1754481600000`;
        const first = await servePublicResource({
            request: new Request(url),
            ...fixture,
        });
        await Promise.all(fixture.pending);
        const second = await servePublicResource({
            request: new Request(url),
            ...fixture,
        });

        assert.equal(first.status, 200);
        assert.equal(first.headers.get("X-ImgHub-Cache"), "MISS");
        assert.match(first.headers.get("Cache-Control"), /max-age=0/);
        assert.match(first.headers.get("Cache-Control"), /s-maxage=31536000/);
        assert.doesNotMatch(first.headers.get("Cache-Control"), /immutable/);
        assert.equal(second.headers.get("X-ImgHub-Cache"), "HIT");
        assert.deepEqual(fixture.calls, { metadata: 2, object: 1, put: 1 });
        if (kind === "text") {
            assert.equal(await second.text(), "cached text");
            assert.match(second.headers.get("Content-Type"), /^text\/plain/);
        }
    });
}

test("unversioned, mismatched-version, and HEAD reads bypass edge storage", async () => {
    const fixture = createFixture("file");
    const base = `https://images.example.com/${fixture.route.publicId}`;
    for (const request of [
        new Request(base),
        new Request(`${base}?v=999`),
        new Request(`${base}?v=1754481600000`, { method: "HEAD" }),
    ]) {
        const response = await servePublicResource({ request, ...fixture });
        assert.equal(response.headers.get("X-ImgHub-Cache"), "BYPASS");
    }
    assert.deepEqual(fixture.calls, { metadata: 3, object: 3, put: 0 });
});

test("a blocked resource cannot be served from an existing edge cache entry", async () => {
    const fixture = createFixture("file");
    const url = `https://images.example.com/${fixture.route.publicId}?v=1754481600000`;
    const first = await servePublicResource({ request: new Request(url), ...fixture });
    await Promise.all(fixture.pending);
    assert.equal(first.status, 200);

    fixture.deny();
    const blocked = await servePublicResource({ request: new Request(url), ...fixture });

    assert.equal(blocked.status, 404);
    assert.equal(blocked.headers.get("X-ImgHub-Cache"), null);
    assert.deepEqual(fixture.calls, { metadata: 2, object: 1, put: 1 });
});
