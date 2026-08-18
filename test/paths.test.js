import assert from "node:assert/strict";
import test from "node:test";

import {
    buildObjectKey,
    buildPublicUrl,
    normalizeDirectory,
    sanitizeFileName,
} from "../src/paths.js";

test("normalizes safe user subdirectories", () => {
    assert.equal(normalizeDirectory("  trips//2026/summer/ "), "trips/2026/summer");
    assert.equal(normalizeDirectory(""), "");
    assert.throws(() => normalizeDirectory("../other-user"), /invalid directory/i);
    assert.throws(() => normalizeDirectory("a/./b"), /invalid directory/i);
});

test("sanitizes file names without accepting path components", () => {
    assert.equal(sanitizeFileName("  my photo (1).png "), "my-photo-1.png");
    assert.throws(() => sanitizeFileName("../../secret.txt"), /invalid file name/i);
    assert.throws(() => sanitizeFileName(".."), /invalid file name/i);
});

test("builds isolated R2 keys for files and text", () => {
    assert.equal(
        buildObjectKey("user_123", "file", "trips/2026", "lake.png"),
        "users/user_123/file/trips/2026/lake.png",
    );
    assert.equal(
        buildObjectKey("user_123", "text", "notes", "packing.txt"),
        "users/user_123/text/notes/packing.txt",
    );
    assert.throws(() => buildObjectKey("../escape", "file", "", "x.png"), /invalid user/i);
});

test("public URLs use an opaque identifier and never reveal ownership or storage paths", () => {
    const publicId = "0123456789abcdef0123456789abcdef";
    const shortPublicId = "aB3k9Z";
    assert.equal(
        buildPublicUrl("https://img.example.com", publicId, 0),
        `https://img.example.com/pub/${publicId}?v=0`,
    );
    assert.equal(
        buildPublicUrl("https://img.example.com/", shortPublicId, 1),
        `https://img.example.com/pub/${shortPublicId}?v=1`,
    );
    assert.throws(() => buildPublicUrl(
        "https://img.example.com", "not-public", 1,
    ), /invalid public identifier/i);
    assert.throws(() => buildPublicUrl(
        "https://img.example.com", `pub_${publicId}`, 1,
    ), /invalid public identifier/i);
    assert.throws(() => buildPublicUrl(
        "https://img.example.com", "short", 1,
    ), /invalid public identifier/i);
    assert.throws(() => buildPublicUrl(
        "https://img.example.com", "with_l", 1,
    ), /invalid public identifier/i);
});
