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
    const publicId = "0123456789abcdef0123456789abcdef";
    const shortPublicId = "aB3k9Z";
    assert.deepEqual(routePublicResource(`/pub/${publicId}`), { publicId });
    assert.deepEqual(routePublicResource(`/pub/${shortPublicId}`), { publicId: shortPublicId });
    assert.equal(routePublicResource(`/pub/pub_${publicId}`), null);
    assert.equal(routePublicResource(`/file/${publicId}`), null);
    assert.equal(routePublicResource(`/text/${publicId}`), null);
    assert.equal(routePublicResource(`/${publicId}`), null);
    assert.equal(routePublicResource(`/pub/${publicId}/extra`), null);
    assert.equal(routePublicResource("/pub/short"), null);
    assert.equal(routePublicResource("/pub/has-invalid-dash"), null);
    assert.equal(routePublicResource("/pub/with_l"), null);
    assert.equal(routePublicResource("/pub/with_O"), null);
    assert.equal(routePublicResource("/file/something"), null);
    assert.equal(routePublicResource(`/image/${publicId}`), null);
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
