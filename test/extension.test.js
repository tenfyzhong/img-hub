import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildExtensionPackages, createManifest } from "../extension/scripts/build.mjs";

test("extension manifests share one configurable WebExtension implementation", () => {
    const chromium = createManifest({ browser: "chromium", version: "1.2.3" });
    const firefox = createManifest({ browser: "firefox", version: "1.2.3" });

    assert.equal(chromium.manifest_version, 3);
    assert.equal(chromium.version, "1.2.3");
    assert.deepEqual(chromium.permissions, ["storage", "clipboardWrite"]);
    assert.ok(chromium.optional_host_permissions.includes("https://*/*"));
    assert.equal(chromium.action.default_popup, "popup.html");
    assert.equal(chromium.icons[128], "icons/icon-128.png");
    assert.equal(chromium.browser_specific_settings, undefined);

    assert.equal(firefox.browser_specific_settings.gecko.id, "img-hub@tenfyzhong.com");
    assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, "142.0");
    assert.deepEqual(
        firefox.browser_specific_settings.gecko.data_collection_permissions.required,
        ["none"],
    );
});

test("extension builds generic Chromium and Firefox packages", async (context) => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "img-hub-extension-"));
    context.after(() => rm(outputDirectory, { recursive: true, force: true }));

    const result = await buildExtensionPackages({
        projectDirectory: new URL("..", import.meta.url).pathname,
        outputDirectory,
        version: "1.2.3",
    });

    assert.match(result.chromiumZip, /img-hub-extension-chromium-v1\.2\.3\.zip$/);
    assert.match(result.firefoxZip, /img-hub-extension-firefox-v1\.2\.3\.zip$/);
    assert.ok((await stat(result.chromiumZip)).size > 100);
    assert.ok((await stat(result.firefoxZip)).size > 100);
    const icon = await readFile(join(outputDirectory, "chromium", "icons", "icon-128.png"));
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(icon.readUInt32BE(16), 128);
    assert.equal(icon.readUInt32BE(20), 128);

    const popup = await readFile(join(outputDirectory, "chromium", "popup.html"), "utf8");
    const client = await readFile(join(outputDirectory, "chromium", "popup.js"), "utf8");
    assert.match(popup, /deployment-url/);
    assert.match(popup, /login-form/);
    assert.match(popup, /upload-form/);
    assert.match(client, /permissions\.request/);
    assert.match(client, /\/api\/auth\/login/);
    assert.match(client, /\/api\/auth\/logout/);
    assert.match(client, /turnstile_required/);
    assert.match(client, /open the ImgHub website/i);
    assert.match(client, /\/api\/files/);
    assert.match(client, /md5File/);
    assert.match(client, /\/api\/files\/instant/);
    assert.doesNotMatch(`${popup}\n${client}`, /workers\.dev|img-hub\.[a-z]/i);

    const chromiumManifest = JSON.parse(
        await readFile(join(outputDirectory, "chromium", "manifest.json"), "utf8"),
    );
    const firefoxManifest = JSON.parse(
        await readFile(join(outputDirectory, "firefox", "manifest.json"), "utf8"),
    );
    assert.equal(chromiumManifest.browser_specific_settings, undefined);
    assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "img-hub@tenfyzhong.com");
});
