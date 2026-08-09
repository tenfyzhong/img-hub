import assert from "node:assert/strict";
import test from "node:test";

import { md5File } from "../public/md5.js";

test("calculates MD5 incrementally for upload preflight", async () => {
    const progress = [];
    const digest = await md5File(new Blob(["hello world"]), (fraction) => progress.push(fraction), 3);

    assert.equal(digest, "5eb63bbbe01eeed093cb22bb8f5acdc3");
    assert.ok(progress.length >= 4);
    assert.equal(progress.at(-1), 1);
});

test("calculates the standard empty-file MD5", async () => {
    assert.equal(await md5File(new Blob([])), "d41d8cd98f00b204e9800998ecf8427e");
});
