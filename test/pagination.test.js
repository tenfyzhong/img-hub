import assert from "node:assert/strict";
import test from "node:test";

import { escapeLikePattern, normalizePageOptions } from "../src/pagination.js";

test("normalizes bounded pagination and search options", () => {
    assert.deepEqual(normalizePageOptions({ page: "2", pageSize: "25", query: "  alice  " }), {
        page: 2,
        pageSize: 25,
        query: "alice",
        offset: 25,
    });
    assert.deepEqual(normalizePageOptions({ page: "0", pageSize: "500", query: "" }), {
        page: 1,
        pageSize: 100,
        query: "",
        offset: 0,
    });
    assert.throws(() => normalizePageOptions({ query: "x".repeat(101) }), /search.*100/i);
});

test("escapes SQL LIKE wildcard characters in literal searches", () => {
    assert.equal(escapeLikePattern("100%_done\\now"), "%100\\%\\_done\\\\now%");
});
