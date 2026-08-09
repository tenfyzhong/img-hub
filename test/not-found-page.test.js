import assert from "node:assert/strict";
import test from "node:test";

import { publicNotFound } from "../src/not-found-page.js";

test("public 404 page is a secure English document with a route home", async () => {
    const response = publicNotFound(new Request("https://img.example.com/pub/missing", {
        headers: { "Accept-Language": "en-US,en;q=0.9" },
    }));
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(response.headers.get("Content-Type"), /^text\/html/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
    assert.match(body, /<html lang="en">/);
    assert.match(body, /Resource not found/);
    assert.match(body, /href="\/"/);
    assert.match(body, />404</);
    assert.doesNotMatch(body, /pub\/missing/);
});

test("public 404 page follows Chinese browser preference and HEAD omits its body", async () => {
    const request = new Request("https://img.example.com/pub/missing", {
        method: "HEAD",
        headers: { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    });
    const response = publicNotFound(request);

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("Content-Language"), "zh-CN");
});
