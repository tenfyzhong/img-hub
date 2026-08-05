import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../src/errors.js";
import { assertSameOrigin, parseCookies, progressStream, routePublicResource } from "../src/http.js";

test("parses encoded cookies", () => {
    assert.deepEqual(parseCookies("theme=dark; img_hub_session=a%2Fb; empty="), {
        theme: "dark",
        img_hub_session: "a/b",
        empty: "",
    });
});

test("rejects cross-origin state-changing requests", () => {
    assert.throws(() => assertSameOrigin(new Request("https://img.example.com/api/files", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
    })), /origin/i);
    assert.doesNotThrow(() => assertSameOrigin(new Request("https://img.example.com/api/files", {
        method: "POST",
        headers: { Origin: "https://img.example.com" },
    })));
    assert.doesNotThrow(() => assertSameOrigin(new Request("https://img.example.com/api/auth/login", {
        method: "POST",
        headers: { Origin: "chrome-extension://abcdefghijklmnop" },
    })));
    assert.doesNotThrow(() => assertSameOrigin(new Request("https://img.example.com/api/auth/login", {
        method: "POST",
        headers: { Origin: "moz-extension://12345678-1234-1234-1234-123456789abc" },
    })));
});

test("parses opaque public routes while retaining legacy route compatibility", () => {
    const publicId = "pub_0123456789abcdef0123456789abcdef";
    assert.deepEqual(routePublicResource(`/file/${publicId}`), {
        kind: "file",
        publicId,
    });
    assert.deepEqual(routePublicResource("/file/alice/trips/lake.png"), {
        kind: "file",
        username: "alice",
        directory: "trips",
        name: "lake.png",
    });
    assert.deepEqual(routePublicResource("/text/alice/notes/hello.txt"), {
        kind: "text",
        username: "alice",
        directory: "notes",
        name: "hello.txt",
    });
    assert.equal(routePublicResource("/file/alice"), null);
    assert.equal(routePublicResource("/api/files"), null);
});

test("streams newline-delimited progress and serializes application errors", async () => {
    const response = progressStream(async (send) => {
        send({ type: "progress", percent: 25 });
        throw new AppError(400, "Remote file failed", "remote_fetch_failed");
    });
    const events = (await response.text()).trim().split("\n").map(JSON.parse);

    assert.match(response.headers.get("Content-Type"), /^application\/x-ndjson/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(events[0], { type: "progress", percent: 25 });
    assert.deepEqual(events[1], {
        type: "error",
        error: {
            code: "remote_fetch_failed",
            message: "Remote file failed",
            status: 400,
        },
    });
});
