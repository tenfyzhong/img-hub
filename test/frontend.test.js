import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the web app exposes setup, login, administration, and resource controls", async () => {
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

test("authentication pages do not expose a public resource path example", async () => {
    const [html, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);
    const authentication = html.match(/<section id="auth-shell"[\s\S]*?<section id="password-gate"/)?.[0] || "";

    assert.doesNotMatch(authentication, /path-preview|\/pub_|\?v=/);
    assert.doesNotMatch(css, /\.path-preview/);
});

test("publish results can be dismissed and clear when navigating menus or upload tabs", async () => {
    const [html, javascript] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    ]);
    const shareResult = html.match(/<div id="upload-share-result"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || "";

    assert.match(shareResult, /id="dismiss-upload-share"[^>]*class="share-result-close"/);
    assert.match(shareResult, /data-i18n-title="common\.close"/);
    assert.match(shareResult, /data-i18n-aria-label="common\.close"/);
    assert.match(shareResult, />×<\/button>/);
    assert.doesNotMatch(shareResult, /data-i18n="resource\.dismissResult"|>Dismiss result<|>删除结果</);
    assert.match(javascript, /function clearShareResult\(\)[\s\S]*?state\.lastShareFormats = null;[\s\S]*?show\(byId\("upload-share-result"\), false\);/);
    assert.match(javascript, /byId\("dismiss-upload-share"\)\.addEventListener\("click", clearShareResult\);/);
    assert.match(javascript, /function switchView\(name\) \{\s*clearShareResult\(\);/);
    assert.match(javascript, /function selectUploadMode\(mode\) \{\s*clearShareResult\(\);/);
});

test("content audit and user management use separate searchable paginated menus", async () => {
    const [html, javascript, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);

    for (const view of ["audit", "users", "admin"]) {
        assert.match(html, new RegExp(`data-view=["']${view}["']`));
        assert.match(html, new RegExp(`id=["']view-${view}["']`));
    }
    const auditView = html.match(/<section id="view-audit"[\s\S]*?<section id="view-users"/)?.[0] || "";
    const usersView = html.match(/<section id="view-users"[\s\S]*?<section id="view-admin"/)?.[0] || "";
    const adminView = html.match(/<section id="view-admin"[\s\S]*?<\/section>\s*<\/div>/)?.[0] || "";
    assert.match(auditView, /id="audit-search-form"/);
    assert.match(auditView, /id="audit-pagination"/);
    assert.doesNotMatch(auditView, /id="user-form"/);
    assert.match(usersView, /id="user-search-form"/);
    assert.match(usersView, /id="user-pagination"/);
    assert.match(usersView, /id="open-user-create"/);
    assert.doesNotMatch(adminView, /id="audit-list"|id="user-list"/);
    assert.match(javascript, /URLSearchParams/);
    assert.match(javascript, /loadAudit/);
    assert.match(javascript, /loadUsers/);
    assert.match(css, /\.management-toolbar/);
    assert.match(css, /\.pagination/);
});

test("primary account views fill the row and user creation opens in a right drawer", async () => {
    const [html, javascript, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);

    assert.match(css, /\.mode-switch\s*\{[^}]*width:\s*100%/s);
    assert.match(css, /\.security-page-card\s*\{[^}]*width:\s*100%/s);
    assert.match(css, /\.api-keys-card\s*\{[^}]*width:\s*100%/s);
    assert.doesNotMatch(css, /\.api-keys-card[^}]*max-width:\s*520px/s);

    const usersView = html.match(/<section id="view-users"[\s\S]*?<section id="view-admin"/)?.[0] || "";
    const drawer = html.match(/<dialog id="user-create-drawer"[\s\S]*?<\/dialog>/)?.[0] || "";
    assert.match(usersView, /id="open-user-create"/);
    assert.match(usersView, /id="user-search-form"/);
    assert.doesNotMatch(usersView, /id="user-form"/);
    assert.match(drawer, /id="user-form"/);
    assert.match(drawer, /id="close-user-create"/);
    assert.match(css, /\.drawer\s*\{/);
    assert.match(css, /\.drawer\[open\]/);
    assert.match(javascript, /user-create-drawer/);
    assert.match(javascript, /open-user-create/);
    assert.match(javascript, /close-user-create/);
});

test("R2 retention is configured by the deployed backend without browser credential fields", async () => {
    const [html, javascript, worker] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    ]);

    assert.doesNotMatch(html, /name="(?:accountId|bucketName|apiToken)"/);
    assert.match(html, /id="retention-form"/);
    assert.match(html, /name="retentionDays"[^>]*type="number"/);
    assert.match(javascript, /\/api\/admin\/retention/);
    assert.match(worker, /async scheduled\(/);
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
    assert.doesNotMatch(accountNavigation, /data-view="(?:audit|users|admin)"/);

    const adminNavigation = html.match(/<nav data-admin-only[\s\S]*?<\/nav>/)?.[0] || "";
    assert.match(adminNavigation, /data-view="audit"/);
    assert.match(adminNavigation, /data-view="users"/);
    assert.match(adminNavigation, /data-view="admin"/);

    const securityView = html.match(/<section id="view-security"[\s\S]*?<section id="view-api-keys"/)?.[0] || "";
    const apiKeysView = html.match(/<section id="view-api-keys"[\s\S]*?<section id="view-audit"/)?.[0] || "";
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

test("administrator password generation copies immediately and copy feedback is visible", async () => {
    const [javascript, css, translations] = await Promise.all([
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
        readFile(new URL("../public/i18n.js", import.meta.url), "utf8"),
    ]);

    assert.match(javascript,
        /function notify\(message, error = false, duration = 4200\)[\s\S]*?setTimeout\(\(\) => show\(toast, false\), duration\)/);
    assert.match(javascript,
        /generate-user-password[\s\S]*?generateForForm\(byId\("user-form"\)\)[\s\S]*?copyText\([\s\S]*?message\.passwordGeneratedCopied[\s\S]*?duration:\s*2000/);
    assert.match(javascript,
        /copy-user-password[\s\S]*?copyText\([\s\S]*?message\.passwordCopied[\s\S]*?duration:\s*2000[\s\S]*?feedbackElement:/);
    assert.match(javascript,
        /function animateCopySuccess[\s\S]*?classList\.add\("copy-success"\)/);
    assert.match(css, /\.password-tools button\.copy-success\s*\{[^}]*animation:/s);
    assert.match(css, /@keyframes password-copy-success/);
    assert.match(translations, /"message\.passwordGeneratedCopied": "Password generated and copied"/);
    assert.match(translations, /"message\.passwordGeneratedCopied": "随机密码已生成并复制"/);
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

test("text publishing omits plain text and every manager preview stays inside its card", async () => {
    const [html, javascript, css] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    ]);

    const textPanel = html.match(/<div id="upload-text-panel"[\s\S]*?<div id="upload-remote-panel"/)?.[0] || "";
    assert.doesNotMatch(textPanel, /<option value="plain"/);
    assert.match(textPanel, /<option value="markdown"/);
    assert.match(textPanel, /<option value="rich"/);
    assert.match(javascript, /resource\.kind === "text"[\s\S]*?document\.createElement\("iframe"\)/);
    assert.match(javascript, /preview\.className = "resource-preview"/);
    assert.match(css, /\.resource-card\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.resource-icon\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.resource-icon img\s*\{[^}]*object-fit:\s*contain/s);
    assert.match(css, /\.resource-icon iframe\s*\{[^}]*max-width:\s*100%/s);
});

test("publishing uses optional generated text names, share results, MD5 instant upload, and session refresh", async () => {
    const [html, javascript] = await Promise.all([
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    ]);

    const textPanel = html.match(/<div id="upload-text-panel"[\s\S]*?<div id="upload-remote-panel"/)?.[0] || "";
    const nameInput = textPanel.match(/<input name="name"[^>]*>/)?.[0] || "";
    assert.doesNotMatch(nameInput, /\srequired(?:\s|>)/);
    assert.match(nameInput, /data-i18n-placeholder="texts\.namePlaceholder"/);
    assert.match(javascript, /md5File/);
    assert.match(javascript, /\/api\/files\/instant/);
    assert.match(javascript, /files\.checkingDuplicate/);
    assert.match(javascript, /const result = await api\(editing[\s\S]*?showShareResult\(result\.resource\)/);
    assert.match(javascript, /\/api\/auth\/refresh/);
    assert.match(javascript, /response\.status === 401[\s\S]*?refreshSession/);
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
