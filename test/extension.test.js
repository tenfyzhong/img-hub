import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { tryWriteClipboard } from "../extension/src/clipboard.js";
import { buildExtensionPackages, createManifest } from "../extension/scripts/build.mjs";
import { resolveLanguage, translations } from "../public/i18n.js";

function readPngPixels(buffer) {
    const idatChunks = [];
    let width;
    let height;
    for (let offset = 8; offset < buffer.length;) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
        } else if (type === "IDAT") {
            idatChunks.push(data);
        }
        offset += 12 + length;
    }
    const rows = inflateSync(Buffer.concat(idatChunks));
    return {
        pixel(x, y) {
            const offset = y * (1 + width * 4) + 1 + x * 4;
            return [...rows.subarray(offset, offset + 4)];
        },
        width,
        height,
    };
}

test("extension clipboard failures do not turn successful uploads into errors", async () => {
    const writes = [];
    assert.equal(await tryWriteClipboard({
        async writeText(value) {
            writes.push(value);
        },
    }, "https://images.example.com/pub/example"), true);
    assert.deepEqual(writes, ["https://images.example.com/pub/example"]);

    assert.equal(await tryWriteClipboard({
        async writeText() {
            throw new DOMException("Document is not focused", "NotAllowedError");
        },
    }, "https://images.example.com/pub/example"), false);
    assert.equal(await tryWriteClipboard(null, "https://images.example.com/pub/example"), false);
});

test("extension manifests share one configurable WebExtension implementation", () => {
    const chrome = createManifest({ browser: "chrome", version: "1.2.3" });
    const edge = createManifest({ browser: "edge", version: "1.2.3" });
    const firefox = createManifest({ browser: "firefox", version: "1.2.3" });
    const development = createManifest({ browser: "chrome", version: "0.0.0-dev" });
    const taggedRelease = createManifest({ browser: "chrome", version: "v1.2.3" });

    for (const manifest of [chrome, edge, firefox]) {
        assert.equal(manifest.manifest_version, 3);
        assert.equal(manifest.version, "1.2.3");
        assert.equal(manifest.default_locale, "en");
        assert.equal(manifest.name, "__MSG_extensionName__");
        assert.equal(manifest.action.default_title, "__MSG_extensionName__");
        assert.deepEqual(manifest.permissions, ["storage", "clipboardWrite"]);
        assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
        assert.equal(manifest.action.default_popup, "popup.html");
        assert.equal(manifest.icons[128], "icons/icon-128.png");
    }
    assert.equal(chrome.browser_specific_settings, undefined);
    assert.equal(edge.browser_specific_settings, undefined);
    assert.equal(development.version, "0.0.0.1");
    assert.equal(development.version_name, "0.0.0-dev");
    assert.equal(taggedRelease.version, "1.2.3");

    assert.equal(firefox.browser_specific_settings.gecko.id, "img-hub@tenfyzhong.com");
    assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, "142.0");
    assert.deepEqual(
        firefox.browser_specific_settings.gecko.data_collection_permissions.required,
        ["none"],
    );
});

test("extension builds dedicated Chrome, Edge, and Firefox packages", async (context) => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "img-hub-extension-"));
    context.after(() => rm(outputDirectory, { recursive: true, force: true }));

    const result = await buildExtensionPackages({
        projectDirectory: new URL("..", import.meta.url).pathname,
        outputDirectory,
        version: "1.2.3",
    });

    assert.match(result.chromeZip, /img-hub-extension-chrome-v1\.2\.3\.zip$/);
    assert.match(result.edgeZip, /img-hub-extension-edge-v1\.2\.3\.zip$/);
    assert.match(result.firefoxZip, /img-hub-extension-firefox-v1\.2\.3\.zip$/);
    assert.ok((await stat(result.chromeZip)).size > 100);
    assert.ok((await stat(result.edgeZip)).size > 100);
    assert.ok((await stat(result.firefoxZip)).size > 100);
    const icon = await readFile(join(outputDirectory, "chrome", "icons", "icon-128.png"));
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(icon.readUInt32BE(16), 128);
    assert.equal(icon.readUInt32BE(20), 128);
    const raster = readPngPixels(icon);
    assert.deepEqual(raster.pixel(64, 64), [49, 92, 73, 255]);
    assert.deepEqual(raster.pixel(75, 49), [245, 241, 232, 255]);
    assert.deepEqual(raster.pixel(55, 75), [245, 241, 232, 255]);
    assert.deepEqual(raster.pixel(0, 0), [0, 0, 0, 0]);

    const popup = await readFile(join(outputDirectory, "chrome", "popup.html"), "utf8");
    const client = await readFile(join(outputDirectory, "chrome", "popup.js"), "utf8");
    const styles = await readFile(join(outputDirectory, "chrome", "popup.css"), "utf8");
    const popupI18n = await readFile(join(outputDirectory, "chrome", "i18n.js"), "utf8");
    const popupUiUtils = await readFile(join(outputDirectory, "chrome", "ui-utils.js"), "utf8");
    const site = await readFile(join(new URL("..", import.meta.url).pathname, "public", "index.html"), "utf8");
    const brandPath = /M7 27\.5 15\.5 19l5\.2 5\.2 4\.5-4\.5L33 27\.5V33H7Z/;
    for (const markup of [site, popup]) {
        assert.match(markup, brandPath);
        assert.match(markup, /<circle cx="25\.5" cy="12\.5" r="4">/);
    }
    assert.match(popup, /deployment-url/);
    assert.match(popup, /<form id="login-form"[\s\S]*id="deployment-url"/);
    assert.doesNotMatch(popup, /id="connection-form"/);
    assert.match(popup, /id="deployment-link"/);
    assert.match(popup, /id="upload-file-tab"/);
    assert.match(popup, /id="upload-text-tab"/);
    assert.match(popup, /id="upload-remote-tab"/);
    assert.match(popup, /id="file-upload-form"/);
    const dropZone = popup.match(/<label id="file-drop-zone"[\s\S]*?<\/label>/)?.[0] || "";
    assert.match(dropZone, /class="file-picker"/);
    assert.match(dropZone, /tabindex="0"/);
    assert.match(dropZone, /data-i18n-aria-label="files\.pasteAria"/);
    assert.match(dropZone, /id="file-picker"[^>]*class="visually-hidden"[^>]*type="file"[^>]*multiple/);
    assert.doesNotMatch(dropZone, /accept=/);
    assert.match(dropZone, /data-i18n="files\.choose"/);
    assert.match(dropZone, /data-i18n="files\.autoUpload"/);
    assert.match(popup, /id="text-form"/);
    assert.match(popup, /id="remote-file-form"/);
    assert.match(popup, /id="recent-card"[^>]*class="card recent-card"[^>]*aria-busy="false"/);
    assert.match(popup, /id="recent-loading"[^>]*class="recent-loading"[^>]*role="status"[^>]*hidden/);
    assert.match(popup, /data-i18n="extension\.loadingUploads"/);
    assert.match(popup, /Recent 10 uploads/);
    assert.match(client, /permissions\.request/);
    assert.match(client, /\/api\/auth\/login/);
    assert.match(client, /\/api\/auth\/logout/);
    assert.match(client, /turnstile_required/);
    assert.match(client, /extension\.turnstileInstruction/);
    assert.equal(
        translations.en["extension.turnstileInstruction"],
        "Open the ImgHub website, complete login verification, then retry here.",
    );
    assert.equal(
        translations["zh-CN"]["extension.turnstileInstruction"],
        "请打开 ImgHub 站点完成登录安全验证，然后在这里重试。",
    );
    assert.match(client, /api\("\/api\/resources"\)/);
    assert.match(client, /function setRecentLoading/);
    assert.match(client, /setRecentLoading\(true\)[\s\S]*finally\s*\{[\s\S]*setRecentLoading\(false\)/);
    assert.match(client, /sort\([\s\S]*createdAt/);
    assert.match(client, /slice\(0, 10\)/);
    assert.match(client, /\/api\/files/);
    assert.match(client, /md5File/);
    assert.match(client, /\/api\/files\/instant/);
    assert.match(client, /\/api\/texts/);
    assert.match(client, /\/api\/files\/import/);
    assert.match(client, /import\s*\{\s*filesFromClipboard\s*\}\s*from\s*"\.\/ui-utils\.js"/);
    assert.match(client, /dragover/);
    assert.match(client, /addEventListener\("drop"/);
    assert.match(client, /document\.addEventListener\("paste"/);
    assert.match(client, /isEditablePasteTarget/);
    assert.match(client, /filesFromClipboard\(event\.clipboardData\)/);
    assert.match(client, /addEventListener\("change",\s*\(event\)\s*=>\s*uploadFiles/);
    assert.match(client, /tryWriteClipboard\(navigator\.clipboard,\s*latestResource\.url\)/);
    const uploadFilesSource = client.match(/async function uploadFiles[\s\S]*?\n\}/)?.[0] || "";
    assert.doesNotMatch(uploadFilesSource, /navigator\.clipboard\.writeText/);
    assert.match(popupUiUtils, /export function filesFromClipboard/);
    assert.match(client, /elements\["login-form"\]\.hidden = signedIn/);
    assert.match(client, /elements\["deployment-url"\]\.value = state\.deploymentUrl/);
    assert.doesNotMatch(client, /saveState\(\{[^}]*password/s);
    assert.match(client, /LANGUAGE_STORAGE_KEY/);
    assert.match(client, /applyTranslations/);
    assert.match(client, /data-language/);
    assert.match(popupI18n, /resolveLanguage/);
    assert.match(styles, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
    assert.match(styles, /\.file-picker\s*\{[^}]*place-items:\s*center[^}]*text-align:\s*center/s);
    assert.match(styles, /\.file-picker\.dragging,\s*\.file-picker\.pasting\s*\{/);
    assert.match(styles, /\.visually-hidden\s*\{[^}]*position:\s*absolute[^}]*width:\s*1px/s);
    assert.match(styles, /\.recent-loading\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*place-items:\s*center/s);
    assert.match(styles, /\.recent-loading-spinner\s*\{[^}]*animation:\s*recent-loading-spin/s);
    assert.match(styles, /@keyframes\s+recent-loading-spin/);
    assert.match(styles, /body\s*\{[^}]*width:\s*780px/s);
    assert.match(
        styles,
        /#workspace\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    );
    assert.match(styles, /\.session-line\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
    assert.doesNotMatch(styles, /@media\s*\(min-width:\s*700px\)/);
    assert.doesNotMatch(`${popup}\n${client}`, /workers\.dev|img-hub\.[a-z]/i);

    const popupTranslationKeys = [...popup.matchAll(
        /data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g,
    )].map((match) => match[1]);
    assert.ok(popupTranslationKeys.length > 25);
    for (const key of popupTranslationKeys) {
        assert.ok(Object.hasOwn(translations.en, key), `missing extension English translation: ${key}`);
        assert.ok(Object.hasOwn(translations["zh-CN"], key), `missing extension Chinese translation: ${key}`);
    }

    const chromeManifest = JSON.parse(
        await readFile(join(outputDirectory, "chrome", "manifest.json"), "utf8"),
    );
    const edgeManifest = JSON.parse(
        await readFile(join(outputDirectory, "edge", "manifest.json"), "utf8"),
    );
    const firefoxManifest = JSON.parse(
        await readFile(join(outputDirectory, "firefox", "manifest.json"), "utf8"),
    );
    assert.equal(chromeManifest.browser_specific_settings, undefined);
    assert.equal(edgeManifest.browser_specific_settings, undefined);
    assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "img-hub@tenfyzhong.com");
    const englishMessages = JSON.parse(
        await readFile(join(outputDirectory, "chrome", "_locales", "en", "messages.json"), "utf8"),
    );
    const chineseMessages = JSON.parse(
        await readFile(join(outputDirectory, "chrome", "_locales", "zh_CN", "messages.json"), "utf8"),
    );
    assert.equal(englishMessages.extensionName.message, "ImgHub Companion");
    assert.equal(chineseMessages.extensionName.message, "ImgHub 助手");
});

test("extension language follows the main site's English and Chinese behavior", () => {
    assert.equal(resolveLanguage(["zh-CN", "en-US"]), "zh-CN");
    assert.equal(resolveLanguage(["en-US", "zh-CN"]), "en");
    assert.equal(resolveLanguage(["en-US"], "zh-CN"), "zh-CN");
    assert.equal(translations.en["extension.openSite"], "Open ImgHub");
    assert.equal(translations["zh-CN"]["extension.openSite"], "打开 ImgHub");
    assert.equal(translations.en["extension.loadingUploads"], "Loading recent uploads…");
    assert.equal(translations["zh-CN"]["extension.loadingUploads"], "正在加载最近上传…");
    assert.equal(
        translations.en["extension.uploadedOneNotCopied"],
        "File uploaded, but the URL could not be copied. Use Copy in recent uploads.",
    );
    assert.equal(
        translations["zh-CN"]["extension.uploadedOneNotCopied"],
        "文件已上传，但无法自动复制 URL，请在最近上传中点击复制。",
    );
    assert.deepEqual(Object.keys(translations.en).sort(), Object.keys(translations["zh-CN"]).sort());
});

test("local extension builds default to the development version", async (context) => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "img-hub-extension-dev-"));
    context.after(() => rm(outputDirectory, { recursive: true, force: true }));

    const result = await buildExtensionPackages({
        projectDirectory: new URL("..", import.meta.url).pathname,
        outputDirectory,
        browsers: ["chrome"],
    });

    assert.match(result.chromeZip, /img-hub-extension-chrome-v0\.0\.0-dev\.zip$/);
    const manifest = JSON.parse(
        await readFile(join(outputDirectory, "chrome", "manifest.json"), "utf8"),
    );
    assert.equal(manifest.version, "0.0.0.1");
    assert.equal(manifest.version_name, "0.0.0-dev");
});

test("package scripts expose local builds for every supported browser", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    assert.match(packageJson.scripts["build:extension"], /build\.mjs/);
    assert.match(packageJson.scripts["build:extension:chrome"], /--browser chrome/);
    assert.match(packageJson.scripts["build:extension:edge"], /--browser edge/);
    assert.match(packageJson.scripts["build:extension:firefox"], /--browser firefox/);
});
