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

test("routes opaque public resource URLs", () => {
    const publicId = "pub_0123456789abcdef0123456789abcdef";
    assert.deepEqual(routePublicResource(`/${publicId}`), { publicId });
    assert.equal(routePublicResource("/file/something"), null);
    assert.equal(routePublicResource("/api/files"), null);
    assert.equal(routePublicResource("/not-a-public-id"), null);
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
