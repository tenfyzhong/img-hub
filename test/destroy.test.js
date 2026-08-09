import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    createCloudflareApi,
    destroyCloudflareDeployment,
    emptyR2Bucket,
    expectedDestroyConfirmation,
    validateDestroyRequest,
} from "../scripts/destroy-cloudflare.mjs";

test("destruction requires the exact repository and irreversible confirmation phrase", () => {
    assert.equal(expectedDestroyConfirmation("owner/img-hub"), "DESTROY owner/img-hub");
    assert.deepEqual(validateDestroyRequest({
        expectedRepository: "owner/img-hub",
        repository: "owner/img-hub",
        confirmation: "DESTROY owner/img-hub",
        confirmed: true,
    }), { repository: "owner/img-hub" });

    for (const request of [
        {
            expectedRepository: "owner/img-hub",
            repository: "other/img-hub",
            confirmation: "DESTROY owner/img-hub",
            confirmed: true,
        },
        {
            expectedRepository: "owner/img-hub",
            repository: "owner/img-hub",
            confirmation: "DESTROY",
            confirmed: true,
        },
        {
            expectedRepository: "owner/img-hub",
            repository: "owner/img-hub",
            confirmation: "DESTROY owner/img-hub",
            confirmed: false,
        },
    ]) {
        assert.throws(() => validateDestroyRequest(request), /refused/i);
    }
});

test("R2 cleanup repeatedly lists the first page and deletes every object", async () => {
    const calls = [];
    const pages = [
        [{ key: "users/1/file/a b.png" }, { key: "users/2/text/中文.md" }],
        [{ key: "users/3/file/last.bin" }],
        [],
    ];
    const deleted = await emptyR2Bucket({
        bucketName: "img-hub-123-files",
        api: {
            async listR2Objects(bucketName) {
                calls.push(["list", bucketName]);
                return pages.shift();
            },
            async deleteR2Object(bucketName, key) {
                calls.push(["delete", bucketName, key]);
            },
        },
    });

    assert.equal(deleted, 3);
    assert.deepEqual(calls, [
        ["list", "img-hub-123-files"],
        ["delete", "img-hub-123-files", "users/1/file/a b.png"],
        ["delete", "img-hub-123-files", "users/2/text/中文.md"],
        ["list", "img-hub-123-files"],
        ["delete", "img-hub-123-files", "users/3/file/last.bin"],
        ["list", "img-hub-123-files"],
    ]);
});

test("Cloudflare R2 object deletion preserves slashes and encodes other key characters", async () => {
    const requests = [];
    const api = createCloudflareApi({
        accountId: "0123456789abcdef0123456789abcdef",
        apiToken: "test-token",
        async fetchImpl(url, options) {
            requests.push({ url, options });
            return new Response(JSON.stringify({ success: true, result: { key: "deleted" } }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        },
    });

    await api.deleteR2Object("bucket-name", "users/1/file/a b#中.png");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url,
        "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/"
        + "r2/buckets/bucket-name/objects/users/1/file/a%20b%23%E4%B8%AD.png");
    assert.equal(requests[0].options.method, "DELETE");
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
});

test("destruction discovers exact managed resources before deleting the full deployment", async () => {
    const calls = [];
    const logs = [];
    const api = {
        async getR2Bucket(name) {
            calls.push(["get-bucket", name]);
            return { name };
        },
        async listD1Databases(name) {
            calls.push(["list-d1", name]);
            return [{ name, uuid: "database-id" }];
        },
        async listTurnstileWidgets(name) {
            calls.push(["list-turnstile", name]);
            return [{ name, sitekey: "site-key" }];
        },
        async getR2LockRules(name) {
            calls.push(["get-locks", name]);
            return { rules: [] };
        },
        async deleteWorker(name) {
            calls.push(["delete-worker", name]);
            return true;
        },
        async listR2Objects(name) {
            calls.push(["list-objects", name]);
            return calls.some(([operation]) => operation === "delete-object")
                ? []
                : [{ key: "users/1/file/example.png" }];
        },
        async deleteR2Object(name, key) {
            calls.push(["delete-object", name, key]);
        },
        async deleteR2Bucket(name) {
            calls.push(["delete-bucket", name]);
        },
        async deleteD1Database(id) {
            calls.push(["delete-d1", id]);
        },
        async deleteTurnstileWidget(sitekey) {
            calls.push(["delete-turnstile", sitekey]);
        },
    };

    const result = await destroyCloudflareDeployment({
        environment: {
            IMG_HUB_RESOURCE_PREFIX: "img-hub-123",
            IMG_HUB_DESTROY_EXPECTED_REPOSITORY: "owner/img-hub",
            IMG_HUB_DESTROY_REPOSITORY: "owner/img-hub",
            IMG_HUB_DESTROY_CONFIRMATION: "DESTROY owner/img-hub",
            IMG_HUB_DESTROY_CONFIRMED: "true",
        },
        api,
        log(message) {
            logs.push(message);
        },
    });

    assert.deepEqual(result, {
        workerDeleted: true,
        bucketDeleted: true,
        databaseDeleted: true,
        turnstileDeleted: true,
        objectCount: 1,
    });
    assert.deepEqual(calls, [
        ["get-bucket", "img-hub-123-files"],
        ["list-d1", "img-hub-123-db"],
        ["list-turnstile", "img-hub-123-login"],
        ["get-locks", "img-hub-123-files"],
        ["delete-worker", "img-hub-123"],
        ["list-objects", "img-hub-123-files"],
        ["delete-object", "img-hub-123-files", "users/1/file/example.png"],
        ["list-objects", "img-hub-123-files"],
        ["delete-bucket", "img-hub-123-files"],
        ["delete-d1", "database-id"],
        ["delete-turnstile", "site-key"],
    ]);
    assert.match(logs.join("\n"), /IRREVERSIBLE/);
    assert.match(logs.join("\n"), /img-hub-123-files/);
});

test("destruction aborts before the first mutation when managed names are ambiguous", async () => {
    let mutated = false;
    const api = {
        async getR2Bucket() {
            return null;
        },
        async listD1Databases(name) {
            return [
                { name, uuid: "one" },
                { name, uuid: "two" },
            ];
        },
        async listTurnstileWidgets() {
            return [];
        },
        async deleteWorker() {
            mutated = true;
        },
    };

    await assert.rejects(() => destroyCloudflareDeployment({
        environment: {
            IMG_HUB_RESOURCE_PREFIX: "img-hub-123",
            IMG_HUB_DESTROY_EXPECTED_REPOSITORY: "owner/img-hub",
            IMG_HUB_DESTROY_REPOSITORY: "owner/img-hub",
            IMG_HUB_DESTROY_CONFIRMATION: "DESTROY owner/img-hub",
            IMG_HUB_DESTROY_CONFIRMED: "true",
        },
        api,
        log() {},
    }), /multiple D1 databases/i);
    assert.equal(mutated, false);
});

test("destruction refuses a locked R2 bucket before deleting any resource", async () => {
    let mutated = false;
    const api = {
        async getR2Bucket(name) {
            return { name };
        },
        async listD1Databases() {
            return [];
        },
        async listTurnstileWidgets() {
            return [];
        },
        async getR2LockRules() {
            return { rules: [{ id: "retain-test-data", enabled: true }] };
        },
        async deleteWorker() {
            mutated = true;
        },
    };

    await assert.rejects(() => destroyCloudflareDeployment({
        environment: {
            IMG_HUB_RESOURCE_PREFIX: "img-hub-123",
            IMG_HUB_DESTROY_EXPECTED_REPOSITORY: "owner/img-hub",
            IMG_HUB_DESTROY_REPOSITORY: "owner/img-hub",
            IMG_HUB_DESTROY_CONFIRMATION: "DESTROY owner/img-hub",
            IMG_HUB_DESTROY_CONFIRMED: "true",
        },
        api,
        log() {},
    }), /bucket lock/i);
    assert.equal(mutated, false);
});

test("GitHub destruction is manual-only and makes irreversible data loss explicit", async () => {
    const workflow = await readFile(
        new URL("../.github/workflows/destroy-cloudflare.yml", import.meta.url),
        "utf8",
    );

    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request(?:_target)?:|push:|schedule:/);
    assert.match(workflow, /repository:/);
    assert.match(workflow, /confirmation:/);
    assert.match(workflow, /confirm_data_loss:/);
    assert.match(workflow, /DESTRUCTIVE|IRREVERSIBLE/);
    assert.match(workflow, /DESTROY \$GITHUB_REPOSITORY/);
    assert.match(workflow, /refs\/heads\/main/);
    assert.match(workflow, /group: cloudflare-production/);
    assert.match(workflow, /npm run destroy:cloudflare/);
    assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
    assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
    assert.match(workflow, /github\.event\.repository\.id/);
});

test("bilingual guides warn that the destruction workflow permanently removes all managed data", async () => {
    const guides = await Promise.all([
        readFile(new URL("../README.md", import.meta.url), "utf8"),
        readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8"),
        readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
        readFile(new URL("../docs/zh-CN.html", import.meta.url), "utf8"),
        readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8"),
        readFile(new URL("../CONTRIBUTING.zh-CN.md", import.meta.url), "utf8"),
    ]);

    for (const guide of guides) {
        assert.match(guide, /Destroy Cloudflare deployment|销毁 Cloudflare 部署/i);
        assert.match(guide, /irreversible|不可恢复|不可逆/i);
        assert.match(guide, /Worker.*R2.*D1.*Turnstile/is);
    }
});
