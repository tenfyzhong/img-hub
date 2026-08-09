import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    createDeploymentConfig,
    findDatabaseId,
    resolveResourceNames,
} from "../scripts/deployment-config.mjs";
import {
    ensureTurnstileWidgetWithWrangler,
    findWorkerHostname,
    normalizeTurnstileDomains,
} from "../scripts/turnstile-wrangler.mjs";

test("generated deployment config binds the provisioned D1 and R2 resources", () => {
    const config = createDeploymentConfig({
        databaseId: "db-id",
        databaseName: "img-hub-db",
        bucketName: "img-hub-files",
        workerName: "img-hub-12345",
        turnstileSiteKey: "0x-site-key",
    });

    assert.equal(config.name, "img-hub-12345");
    assert.equal(config.d1_databases[0].binding, "DB");
    assert.equal(config.d1_databases[0].database_id, "db-id");
    assert.equal(config.r2_buckets[0].binding, "BUCKET");
    assert.equal(config.r2_buckets[0].bucket_name, "img-hub-files");
    assert.deepEqual(config.assets.run_worker_first, [
        "/api/*",
        "/pub/*",
        "/file/*",
        "/text/*",
        "/pub_*",
    ]);
    assert.deepEqual(config.triggers.crons, ["0 3 * * *"]);
    assert.equal(config.vars.TURNSTILE_SITE_KEY, "0x-site-key");
    assert.equal(config.vars.TURNSTILE_SECRET_KEY, undefined);
});

test("deployment resolves workers.dev output and configured Turnstile hostnames", () => {
    assert.equal(findWorkerHostname("Deployed at https://img-hub-12345.team-name.workers.dev"),
        "img-hub-12345.team-name.workers.dev");
    assert.deepEqual(normalizeTurnstileDomains(
        "images.example.com, cdn.example.com,images.example.com",
    ), [
        "images.example.com",
        "cdn.example.com",
    ]);
});

test("deployment creates a Turnstile widget through authenticated Wrangler and returns both keys", () => {
    const commands = [];
    const result = ensureTurnstileWidgetWithWrangler({
        name: "img-hub-12345-login",
        domains: ["img-hub-12345.team-name.workers.dev"],
        wrangler(args) {
            commands.push(args);
            if (args[2] === "list") {
                return { stdout: "[]" };
            }
            return { stdout: JSON.stringify({ sitekey: "0x-site", secret: "0x-secret" }) };
        },
    });

    assert.deepEqual(result, { siteKey: "0x-site", secretKey: "0x-secret" });
    assert.deepEqual(commands, [
        ["turnstile", "widget", "list", "--json"],
        ["turnstile", "widget", "create", "img-hub-12345-login",
            "--domain", "img-hub-12345.team-name.workers.dev", "--mode", "managed", "--json"],
        ["turnstile", "widget", "get", "0x-site", "--json"],
    ]);
});

test("deployment reuses a Turnstile widget and adds missing hostnames idempotently", () => {
    const commands = [];
    const result = ensureTurnstileWidgetWithWrangler({
        name: "img-hub-login",
        domains: ["new.example.com"],
        wrangler(args) {
            commands.push(args);
            if (args[2] === "list") {
                return { stdout: JSON.stringify([{
                    sitekey: "0x-site",
                    name: "img-hub-login",
                    domains: ["old.example.com"],
                    mode: "managed",
                }]) };
            }
            if (args[2] === "get") {
                return { stdout: JSON.stringify({
                    sitekey: "0x-site",
                    secret: "0x-secret",
                    name: "img-hub-login",
                    domains: ["old.example.com"],
                    mode: "managed",
                }) };
            }
            assert.equal(args[2], "update");
            return { stdout: JSON.stringify({
                sitekey: "0x-site",
            }) };
        },
    });

    assert.deepEqual(result, { siteKey: "0x-site", secretKey: "0x-secret" });
    assert.deepEqual(commands[2], [
        "turnstile", "widget", "update", "0x-site",
        "--domain", "old.example.com", "--domain", "new.example.com",
        "--mode", "managed", "--json",
    ]);
});

test("fork deployments get repository-specific Cloudflare resource names", () => {
    assert.deepEqual(resolveResourceNames({ IMG_HUB_RESOURCE_PREFIX: "img-hub-12345" }), {
        workerName: "img-hub-12345",
        databaseName: "img-hub-12345-db",
        bucketName: "img-hub-12345-files",
    });
    assert.deepEqual(resolveResourceNames({
        IMG_HUB_RESOURCE_PREFIX: "team-gallery",
        IMG_HUB_WORKER_NAME: "photos",
        IMG_HUB_DATABASE_NAME: "metadata",
        IMG_HUB_BUCKET_NAME: "objects",
    }), {
        workerName: "photos",
        databaseName: "metadata",
        bucketName: "objects",
    });
});

test("finds an existing D1 database across Wrangler JSON shapes", () => {
    assert.equal(findDatabaseId([
        { name: "other", uuid: "other-id" },
        { name: "img-hub-db", uuid: "db-id" },
    ], "img-hub-db"), "db-id");
    assert.equal(findDatabaseId({ results: [
        { name: "img-hub-db", id: "new-shape-id" },
    ] }, "img-hub-db"), "new-shape-id");
    assert.equal(findDatabaseId([], "img-hub-db"), null);
});

test("GitHub deployment initializes storage and deploys the scheduled worker", async () => {
    const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

    assert.match(workflow, /deploy:cloudflare/);
    assert.match(workflow, /npm run test:local/);
    assert.match(workflow, /npm run check:deploy/);
    assert.match(workflow, /branches:\s*\n\s*- main/);
    assert.match(workflow, /group: cloudflare-production/);
    assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
    assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
    assert.match(workflow, /Turnstile/i);
    assert.match(workflow, /IMG_HUB_TURNSTILE_DOMAINS/);
    assert.match(workflow, /github\.event\.repository\.id/);
    assert.match(workflow, /steps\.cloudflare\.outputs\.enabled/);
});

test("the shared deployment path uses Wrangler auth for Turnstile and injects its secret", async () => {
    const deploy = await readFile(new URL("../scripts/deploy.mjs", import.meta.url), "utf8");

    assert.match(deploy, /ensureTurnstileWidgetWithWrangler/);
    assert.match(deploy, /--secrets-file/);
    assert.doesNotMatch(deploy, /process\.env\.CLOUDFLARE_API_TOKEN/);
    assert.doesNotMatch(deploy, /process\.env\.CLOUDFLARE_ACCOUNT_ID/);
});

test("CI keeps development on develop and validates release-only pull requests to main", async () => {
    const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

    assert.match(workflow, /pull_request:[\s\S]*branches:[\s\S]*develop[\s\S]*main/);
    assert.match(workflow, /push:[\s\S]*branches:[\s\S]*develop/);
    assert.match(workflow, /npm run test:local/);
    assert.match(workflow, /npm run check:deploy/);
    assert.match(workflow, /npm run build:extension/);
    assert.match(workflow, /GITHUB_BASE_REF/);
    assert.match(workflow, /develop\|release\/\*\|hotfix\/\*/);
    assert.doesNotMatch(workflow, /secrets\.|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
});
