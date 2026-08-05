import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

const scriptUrl = new URL("../skills/img-hub/scripts/img_hub.py", import.meta.url);

function runClient(arguments_, environment = {}) {
    return new Promise((resolve) => {
        const child = spawn("python3", [scriptUrl.pathname, ...arguments_], {
            env: { PATH: process.env.PATH, ...environment },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

test("skill is concise, configured by environment, and has no placeholders", async () => {
    const skill = await readFile(new URL("../skills/img-hub/SKILL.md", import.meta.url), "utf8");

    assert.match(skill, /IMG_HUB_URL/);
    assert.match(skill, /IMG_HUB_API_KEY/);
    assert.match(skill, /upload|replace|delete|list/);
    assert.doesNotMatch(skill, /TODO/);
});

test("skill client requires both configuration environment variables", async () => {
    const result = await runClient(["list"]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /IMG_HUB_URL/);
    assert.match(result.stderr, /IMG_HUB_API_KEY/);
});

test("skill client lists files using the configured domain and API key", async (context) => {
    let received;
    const server = createServer((request, response) => {
        received = { url: request.url, authorization: request.headers.authorization };
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ resources: [{ id: "res_one", name: "photo.png" }] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    context.after(() => server.close());
    const address = server.address();

    const result = await runClient(["list", "--kind", "file"], {
        IMG_HUB_URL: `http://127.0.0.1:${address.port}`,
        IMG_HUB_API_KEY: "imh_test_api_key_that_is_long_enough_for_testing_1234",
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(received, {
        url: "/api/resources?kind=file",
        authorization: "Bearer imh_test_api_key_that_is_long_enough_for_testing_1234",
    });
    assert.equal(JSON.parse(result.stdout).resources[0].id, "res_one");
});
