import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fetchRemoteFile } from "../src/remote-file.js";

test("imports an HTTPS image with a safe inferred name", async () => {
    const result = await fetchRemoteFile("https://cdn.example.com/photos/lake.png?size=large", {
        async fetchImpl(url, options) {
            assert.equal(url, "https://cdn.example.com/photos/lake.png?size=large");
            assert.equal(options.redirect, "manual");
            return new Response(new Uint8Array([1, 2, 3]), {
                headers: { "Content-Type": "image/png", "Content-Length": "3" },
            });
        },
    });

    assert.equal(result.name, "lake.png");
    assert.equal(result.contentType, "image/png");
    assert.equal(result.size, 3);
});

test("imports non-image files and uses a safe type-based fallback name", async () => {
    const pdf = await fetchRemoteFile("https://downloads.example.com/get?id=report", {
        async fetchImpl() {
            return new Response(new Uint8Array([37, 80, 68, 70]), {
                headers: { "Content-Type": "application/pdf" },
            });
        },
    });
    const binary = await fetchRemoteFile("https://downloads.example.com/artifact", {
        async fetchImpl() {
            return new Response(new Uint8Array([0, 1, 2]));
        },
    });

    assert.equal(pdf.name, "get.pdf");
    assert.equal(pdf.contentType, "application/pdf");
    assert.equal(binary.name, "artifact.bin");
    assert.equal(binary.contentType, "application/octet-stream");
});

test("remote file import blocks private targets and credentials", async () => {
    for (const url of [
        "http://127.0.0.1/private.pdf",
        "http://localhost/private.zip",
        "http://169.254.169.254/latest/meta-data",
        "https://user:password@example.com/archive.zip",
        "file:///etc/passwd",
    ]) {
        await assert.rejects(fetchRemoteFile(url, { fetchImpl() {} }), /url|host|private/i);
    }
});

test("remote redirects are revalidated before following", async () => {
    await assert.rejects(fetchRemoteFile("https://example.com/file.zip", {
        async fetchImpl() {
            return new Response(null, {
                status: 302,
                headers: { Location: "http://127.0.0.1/private.zip" },
            });
        },
    }), /private|host/i);
});

test("reports real byte progress while a remote file is being fetched", async () => {
    const updates = [];
    const result = await fetchRemoteFile("https://cdn.example.com/archive.zip", {
        onProgress(update) {
            updates.push(update);
        },
        async fetchImpl() {
            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2]));
                    controller.enqueue(new Uint8Array([3, 4, 5]));
                    controller.close();
                },
            }), {
                headers: { "Content-Type": "application/zip", "Content-Length": "5" },
            });
        },
    });

    assert.equal(result.size, 5);
    assert.deepEqual(updates[0], { loaded: 0, total: 5, percent: 0 });
    assert.deepEqual(updates.at(-1), { loaded: 5, total: 5, percent: 100 });
    assert.ok(updates.some((update) => update.loaded === 2 && update.percent === 40));
});

test("the remote file endpoint keeps JSON compatibility and offers an opt-in progress stream", async () => {
    const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

    assert.match(source, /application\/x-ndjson/);
    assert.match(source, /progressStream/);
    assert.match(source, /phase:\s*"fetching"/);
    assert.match(source, /phase:\s*"saving"/);
    assert.match(source, /return json\(\{ resource \}, 201\)/);
    assert.doesNotMatch(source, /fetchRemoteImage|remote_not_image/);
});
