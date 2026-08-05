import assert from "node:assert/strict";
import test from "node:test";

import { buildLifecycleRules, configureLifecycle } from "../src/lifecycle.js";

test("adds a 91-day default deletion rule without dropping existing rules", () => {
    const existing = [{
        id: "abort-multipart",
        enabled: true,
        conditions: { prefix: "" },
        abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 604800 } },
    }];
    const rules = buildLifecycleRules(existing, 91);

    assert.equal(rules.length, 2);
    assert.deepEqual(rules[0], existing[0]);
    assert.deepEqual(rules[1], {
        id: "img-hub-default-expiration",
        enabled: true,
        conditions: { prefix: "users/" },
        deleteObjectsTransition: { condition: { type: "Age", maxAge: 91 * 86400 } },
    });
});

test("replaces only the lifecycle rule managed by this application", () => {
    const rules = buildLifecycleRules([
        { id: "img-hub-default-expiration", enabled: true },
        { id: "keep-me", enabled: true },
    ], 30);

    assert.equal(rules.length, 2);
    assert.equal(rules[0].id, "keep-me");
    assert.equal(rules[1].deleteObjectsTransition.condition.maxAge, 30 * 86400);
});

test("validates lifecycle retention range", () => {
    assert.throws(() => buildLifecycleRules([], 0), /between 1 and 3650/i);
    assert.throws(() => buildLifecycleRules([], 3651), /between 1 and 3650/i);
});

test("updates lifecycle through the Cloudflare API while preserving existing rules", async () => {
    const requests = [];
    const fakeFetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (!options.method || options.method === "GET") {
            return Response.json({ success: true, result: { rules: [{ id: "existing", enabled: true }] } });
        }
        return Response.json({ success: true, result: {} });
    };

    const result = await configureLifecycle({
        accountId: "account-id",
        bucketName: "my bucket",
        apiToken: "secret-token",
        retentionDays: 91,
        fetchImpl: fakeFetch,
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://api.cloudflare.com/client/v4/accounts/account-id/r2/buckets/my%20bucket/lifecycle");
    assert.equal(requests[0].options.headers.Authorization, "Bearer secret-token");
    const body = JSON.parse(requests[1].options.body);
    assert.equal(body.rules[0].id, "existing");
    assert.equal(body.rules[1].deleteObjectsTransition.condition.maxAge, 91 * 86400);
    assert.deepEqual(result, { retentionDays: 91, bucketName: "my bucket" });
    assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test("reports Cloudflare lifecycle API errors", async () => {
    const fakeFetch = async () => Response.json({
        success: false,
        errors: [{ message: "token lacks permission" }],
    }, { status: 403 });

    await assert.rejects(configureLifecycle({
        accountId: "account-id",
        bucketName: "bucket",
        apiToken: "token",
        retentionDays: 91,
        fetchImpl: fakeFetch,
    }), /token lacks permission/i);
});
