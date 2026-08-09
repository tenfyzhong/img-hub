import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRetentionService } from "../src/retention-service.js";

function memorySettings(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        async get(key) {
            return values.get(key) ?? null;
        },
        async set(key, value) {
            values.set(key, String(value));
        },
    };
}

test("administrators configure a bounded backend retention period", async () => {
    const settings = memorySettings();
    const bucket = { async list() { return { objects: [], truncated: false }; } };
    const service = createRetentionService(settings, bucket);

    assert.deepEqual(await service.get({ role: "admin" }), { retentionDays: 91 });
    assert.deepEqual(await service.update({ role: "admin" }, 180), { retentionDays: 180 });
    assert.equal(settings.values.get("r2_retention_days"), "180");
    await assert.rejects(service.update({ role: "user" }, 30), /administrator/i);
    await assert.rejects(service.update({ role: "admin" }, 0), /between 1 and 3650/i);
    await assert.rejects(service.update({ role: "admin" }, 30.5), /between 1 and 3650/i);
});

test("scheduled retention deletes only expired user objects through the R2 binding", async () => {
    const settings = memorySettings({ r2_retention_days: "30" });
    const deleted = [];
    const bucket = {
        async list(options) {
            assert.deepEqual(options, { prefix: "users/", limit: 1000 });
            return {
                objects: [
                    { key: "users/old/file/a", uploaded: new Date("2026-06-01T00:00:00Z") },
                    { key: "users/new/file/b", uploaded: new Date("2026-07-20T00:00:00Z") },
                ],
                truncated: false,
            };
        },
        async delete(keys) {
            deleted.push(...keys);
        },
    };
    const service = createRetentionService(
        settings,
        bucket,
        () => new Date("2026-08-01T00:00:00Z"),
    );

    assert.deepEqual(await service.run(), { scanned: 2, deleted: 1, retentionDays: 30 });
    assert.deepEqual(deleted, ["users/old/file/a"]);
});

test("retention is managed by the deployed backend without Cloudflare credentials in the UI", async () => {
    const [worker, html, javascript, wrangler, deploy] = await Promise.all([
        readFile(new URL("../src/index.js", import.meta.url), "utf8"),
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
        readFile(new URL("../scripts/deploy.mjs", import.meta.url), "utf8"),
    ]);

    assert.match(html, /id="retention-form"/);
    assert.match(html, /name="retentionDays"[^>]*type="number"/);
    assert.doesNotMatch(html, /name="(?:accountId|bucketName|apiToken)"/);
    assert.match(javascript, /\/api\/admin\/retention/);
    assert.match(worker, /async scheduled\(/);
    assert.match(wrangler, /"crons"\s*:\s*\[\s*"0 3 \* \* \*"/);
    assert.match(deploy, /r2["'], ["']bucket["'], ["']lifecycle["'], ["']remove/);
    assert.doesNotMatch(deploy, /r2["'], ["']bucket["'], ["']lifecycle["'], ["'](?:add|set)/);
    assert.doesNotMatch(deploy, /IMG_HUB_RETENTION_DAYS/);
});
