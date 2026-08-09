import assert from "node:assert/strict";
import test from "node:test";

import { timestampResourceName } from "../src/resource-name.js";

const timestamp = new Date("2026-08-06T04:05:06.123Z");

test("adds a millisecond UTC timestamp before a file extension", () => {
    assert.equal(
        timestampResourceName("lake.png", { kind: "file", now: timestamp }),
        "lake-20260806T040506123.png",
    );
    assert.equal(
        timestampResourceName("archive", { kind: "file", now: timestamp }),
        "archive-20260806T040506123",
    );
});

test("generates format-aware names when a published text name is omitted", () => {
    assert.equal(
        timestampResourceName("", { kind: "text", textFormat: "markdown", now: timestamp }),
        "text-20260806T040506123.md",
    );
    assert.equal(
        timestampResourceName("", { kind: "text", textFormat: "rich", now: timestamp }),
        "text-20260806T040506123.html",
    );
});

test("keeps timestamped names within the storage name limit", () => {
    const name = timestampResourceName(`${"a".repeat(170)}.png`, { kind: "file", now: timestamp });

    assert.ok(name.length <= 180);
    assert.match(name, /-20260806T040506123\.png$/);
});
