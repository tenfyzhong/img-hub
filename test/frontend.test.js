import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the web app exposes setup, login, user management, replacement, and lifecycle controls", async () => {
    const [html, javascript] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    ]);

    for (const control of [
        "setup-form",
        "login-form",
        "password-form",
        "api-key-form",
        "site-settings-form",
        "user-form",
        "lifecycle-form",
        "audit-list",
        "file-form",
        "text-form",
    ]) {
        assert.match(html, new RegExp(`id=["']${control}["']`));
    }
    assert.match(javascript, /replaceResource/);
    assert.match(javascript, /deleteResource/);
    assert.match(javascript, /loadApiKeys/);
    assert.match(javascript, /applySiteSettings/);
    assert.match(javascript, /\/api\/site-settings/);
    assert.match(html, /id=["']language-switcher["']/);
    assert.match(html, /data-language=["']zh-CN["']/);
    assert.match(html, /data-i18n-aria-label=["']brand\.home["']/);
    assert.match(javascript, /navigator\.languages/);
    assert.match(javascript, /localStorage/);
    assert.match(javascript, /document\.documentElement\.lang/);
    assert.match(javascript, /\/api\/admin\/resources/);
    assert.match(javascript, /\/status/);
    assert.match(html, /id=["']login-turnstile["']/);
    assert.match(javascript, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
    assert.match(javascript, /turnstile\.render/);
    assert.match(javascript, /turnstileToken/);
    assert.match(javascript, /turnstile\.reset/);
    assert.doesNotMatch(javascript, /event\.currentTarget\.(?:reset|elements)/);
    assert.ok(
        javascript.match(/const form = event\.currentTarget/g)?.length >= 9,
        "every asynchronous form handler must capture currentTarget synchronously",
    );
    const setupForm = html.match(/<form id="setup-form"[\s\S]*?<\/form>/)?.[0] || "";
    assert.doesNotMatch(setupForm, /name="username"/);
});

test("password, upload, file manager, rich text, and history interactions are present", async () => {
    const [html, javascript, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);

    for (const id of [
        "file-upload-progress",
        "remote-file-form",
        "remote-upload-progress",
        "remote-upload-label",
        "remote-upload-percent",
        "remote-upload-meter",
        "directory-tree",
        "resource-grid-view",
        "resource-list-view",
        "upload-share-result",
        "text-format",
        "rich-text-editor",
        "rich-text-toolbar",
        "view-history",
        "history-list",
        "generate-user-password",
        "copy-user-password",
        "password-reset-dialog",
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
    }
    assert.ok((html.match(/name="confirmPassword"/g) || []).length >= 4);
    assert.ok((html.match(/data-password-toggle/g) || []).length >= 8);
    assert.doesNotMatch(html, /\/file\/<b class="username-slot"/);
    assert.match(javascript, /XMLHttpRequest/);
    assert.match(javascript, /upload\.addEventListener\(["']progress/);
    assert.match(javascript, /dragover/);
    assert.match(javascript, /document\.addEventListener\(["']paste["']/);
    assert.match(javascript, /filesFromClipboard/);
    assert.match(javascript, /isContentEditable/);
    assert.match(javascript, /application\/x-ndjson/);
    assert.match(javascript, /response\.body\.getReader\(\)/);
    assert.match(javascript, /updateRemoteProgress/);
    assert.doesNotMatch(html, /Import image|Image URL|外链图片|图片外链/);
    assert.match(javascript, /buildShareFormats/);
    assert.match(javascript, /loadHistory/);
    assert.match(css, /scrollbar-gutter:\s*stable/);
    assert.match(css, /\.view\s*\{[^}]*min-height:/s);
    const dropZone = html.match(/<label id="file-drop-zone"[\s\S]*?<\/label>/)?.[0] || "";
    assert.match(dropZone, /tabindex="0"/);
    assert.match(dropZone, /data-i18n-aria-label="files\.pasteAria"/);
});

test("password visibility icons match the state and API keys have their own menu", async () => {
    const [html, javascript, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);

    const accountNavigation = html.match(/<nav data-i18n-aria-label="nav\.accountAria"[\s\S]*?<\/nav>/)?.[0] || "";
    assert.match(accountNavigation, /data-view="security"/);
    assert.match(accountNavigation, /data-view="api-keys"/);
    assert.ok(accountNavigation.indexOf('data-view="security"') < accountNavigation.indexOf('data-view="api-keys"'));
    assert.ok(accountNavigation.indexOf('data-view="api-keys"') < accountNavigation.indexOf('data-view="admin"'));

    const securityView = html.match(/<section id="view-security"[\s\S]*?<section id="view-api-keys"/)?.[0] || "";
    const apiKeysView = html.match(/<section id="view-api-keys"[\s\S]*?<section id="view-admin"/)?.[0] || "";
    assert.match(securityView, /id="password-form"/);
    assert.doesNotMatch(securityView, /id="api-key-form"/);
    assert.match(apiKeysView, /id="api-key-form"/);
    assert.match(apiKeysView, /id="api-key-list"/);
    assert.match(javascript, /name === "api-keys"\) loadApiKeys\(\)/);
    assert.doesNotMatch(javascript, /name === "security"\) loadApiKeys\(\)/);

    assert.match(css, /\.password-eye-open\s*\{[^}]*display:\s*none/s);
    assert.match(css, /\.password-eye-closed\s*\{[^}]*display:\s*block/s);
    assert.match(css, /\.password-field button\.active \.password-eye-open\s*\{[^}]*display:\s*block/s);
    assert.match(css, /\.password-field button\.active \.password-eye-closed\s*\{[^}]*display:\s*none/s);
});

test("upload uses three equal panels and resource management is unified", async () => {
    const [html, javascript, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);

    assert.match(html, /data-view="upload"/);
    assert.match(html, /data-view="manager"/);
    assert.doesNotMatch(html, /data-view="(?:files|texts)"/);
    for (const id of [
        "view-upload",
        "upload-mode-switch",
        "upload-file-tab",
        "upload-text-tab",
        "upload-remote-tab",
        "upload-file-panel",
        "upload-text-panel",
        "upload-remote-panel",
        "view-manager",
        "manager-library",
        "resource-grid-view",
        "resource-list-view",
        "resource-list",
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
    }
    const uploadView = html.match(/<section id="view-upload"[\s\S]*?<section id="view-manager"/)?.[0] || "";
    const managerView = html.match(/<section id="view-manager"[\s\S]*?<section id="view-history"/)?.[0] || "";
    const filePanel = html.match(/<div id="upload-file-panel"[\s\S]*?<div id="upload-text-panel"/)?.[0] || "";
    const remotePanel = html.match(/<div id="upload-remote-panel"[\s\S]*?<\/section>/)?.[0] || "";
    assert.match(uploadView, /id="file-form"/);
    assert.match(uploadView, /id="text-form"/);
    assert.ok(uploadView.indexOf('id="upload-file-tab"') < uploadView.indexOf('id="upload-text-tab"'));
    assert.ok(uploadView.indexOf('id="upload-text-tab"') < uploadView.indexOf('id="upload-remote-tab"'));
    assert.doesNotMatch(filePanel, /id="remote-file-form"/);
    assert.match(remotePanel, /id="remote-file-form"/);
    assert.doesNotMatch(uploadView, /id="choose-files"/);
    assert.doesNotMatch(uploadView, /id="resource-list"/);
    assert.match(managerView, /id="resource-list"/);
    assert.doesNotMatch(managerView, /id="(?:file-list|text-list|manager-mode-switch|manager-file-tab|manager-text-tab)"/);
    assert.match(javascript, /selectUploadMode/);
    assert.doesNotMatch(javascript, /selectManagerMode/);
    assert.match(javascript, /api\(["']\/api\/resources["']\)/);
    assert.doesNotMatch(javascript, /\/api\/resources\?kind=/);
    assert.doesNotMatch(javascript, /byId\(["']choose-files["']\)/);

    assert.doesNotMatch(html, /class="docs-link"|data-i18n="header\.guide"/);
    assert.doesNotMatch(html, />◉<\/button>/);
    assert.match(javascript, /password-eye-open/);
    assert.match(javascript, /password-eye-closed/);
    assert.match(javascript, /generateForForm[\s\S]*?classList\.add\("active"\)/);
    assert.match(css, /--text-editor-height:/);
    assert.match(css, /#text-content,\s*\.rich-text-editor\s*\{[^}]*height:\s*var\(--text-editor-height\)/s);
    assert.match(css, /\.rich-text-toolbar\.inactive\s*\{[^}]*visibility:\s*hidden/s);
    assert.match(css, /\.upload-mode-stage\s*\{[^}]*height:\s*100%/s);
    assert.match(css, /\.upload-mode-stage\s*>\s*\.mode-panel\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.drop-zone\s*\{[^}]*min-height:\s*(?:2\d\d|[3-9]\d\d)px/s);
});

test("the site uses its own CSS-generated background and brand", async () => {
    const [html, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);

    assert.match(html, /ImgHub/);
    assert.match(css, /background-image:[^;]*(radial-gradient|linear-gradient)/s);
    assert.doesNotMatch(css, /url\([^)]*\.(jpg|jpeg|png|webp)/i);
});
