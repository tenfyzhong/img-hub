import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    getStoreConfiguration,
    publishChrome,
    publishEdge,
} from "../scripts/publish-extensions.mjs";

test("browser store publishing only enables stores with complete credentials", () => {
    const configuration = getStoreConfiguration({
        CHROME_PUBLISHER_ID: "publisher",
        CHROME_EXTENSION_ID: "extension",
        CHROME_CLIENT_ID: "client",
        CHROME_CLIENT_SECRET: "secret",
        CHROME_REFRESH_TOKEN: "refresh",
        EDGE_PRODUCT_ID: "edge-product",
        WEB_EXT_API_KEY: "firefox-key",
        WEB_EXT_API_SECRET: "firefox-secret",
    });

    assert.equal(configuration.chrome, true);
    assert.equal(configuration.edge, false);
    assert.equal(configuration.firefox, true);
});

test("Chrome publication waits for an asynchronous upload before publishing", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "img-hub-chrome-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const packagePath = join(directory, "extension.zip");
    await writeFile(packagePath, "zip");
    const calls = [];
    const responses = [
        Response.json({ access_token: "access-token" }),
        Response.json({ uploadState: "UPLOAD_IN_PROGRESS" }),
        Response.json({ uploadState: "SUCCESS" }),
        Response.json({ status: ["OK"] }),
    ];
    const request = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET" });
        return responses.shift();
    };

    await publishChrome({
        CHROME_PUBLISHER_ID: "publisher",
        CHROME_EXTENSION_ID: "extension",
        CHROME_CLIENT_ID: "client",
        CHROME_CLIENT_SECRET: "secret",
        CHROME_REFRESH_TOKEN: "refresh",
    }, packagePath, request);

    assert.deepEqual(calls.map(({ method }) => method), ["POST", "POST", "GET", "POST"]);
    assert.match(calls[2].url, /:fetchStatus$/);
    assert.match(calls[3].url, /:publish$/);
});

test("Edge publication resolves operation IDs for upload and publish polling", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "img-hub-edge-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const packagePath = join(directory, "extension.zip");
    await writeFile(packagePath, "zip");
    const calls = [];
    const responses = [
        new Response(null, { status: 202, headers: { Location: "upload-operation" } }),
        Response.json({ status: "Succeeded" }),
        new Response(null, { status: 202, headers: { Location: "publish-operation" } }),
        Response.json({ status: "Succeeded" }),
    ];
    const request = async (url, options = {}) => {
        calls.push({ url, options });
        return responses.shift();
    };

    await publishEdge({
        EDGE_PRODUCT_ID: "product",
        EDGE_CLIENT_ID: "client",
        EDGE_API_KEY: "api-key",
    }, packagePath, request);

    assert.match(calls[1].url, /draft\/package\/operations\/upload-operation$/);
    assert.match(calls[3].url, /submissions\/operations\/publish-operation$/);
    assert.equal(calls[0].options.headers.Authorization, "ApiKey api-key");
    assert.equal(calls[0].options.headers["X-ClientID"], "client");
});

test("release workflow versions and releases three browser packages from the tag", async () => {
    const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

    assert.match(workflow, /tags:\s*\[?['"]?v\*/);
    assert.match(workflow, /fetch-depth:\s*0/);
    assert.match(workflow, /merge-base --is-ancestor.*origin\/main/);
    assert.match(workflow, /group: cloudflare-production/);
    assert.match(workflow, /npm run deploy:cloudflare/);
    assert.match(workflow, /IMG_HUB_TURNSTILE_DOMAINS/);
    assert.match(workflow, /IMG_HUB_WECHAT_VERIFY_FILENAME/);
    assert.match(workflow, /IMG_HUB_WECHAT_VERIFY_CONTENT/);
    assert.match(workflow, /npm run test:local/);
    assert.match(workflow, /npm run build:extension -- --version/);
    assert.match(workflow, /GITHUB_REF_NAME/);
    assert.match(workflow, /gh release create/);
    assert.match(workflow, /img-hub-extension-chrome/);
    assert.match(workflow, /img-hub-extension-edge/);
    assert.match(workflow, /img-hub-extension-firefox/);
    assert.match(workflow, /CHROME_REFRESH_TOKEN/);
    assert.match(workflow, /EDGE_API_KEY/);
    assert.match(workflow, /WEB_EXT_API_SECRET/);
    assert.match(workflow, /github\.event\.repository\.id/);
});
