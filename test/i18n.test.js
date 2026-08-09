import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    resolveLanguage,
    translate,
    translations,
} from "../public/i18n.js";

test("browser language selects Chinese only when the preferred locale is Chinese", () => {
    assert.equal(resolveLanguage(["zh-CN", "en-US"]), "zh-CN");
    assert.equal(resolveLanguage(["zh-TW"]), "zh-CN");
    assert.equal(resolveLanguage(["en-US", "zh-CN"]), "en");
    assert.equal(resolveLanguage(["fr-FR"]), "en");
    assert.equal(resolveLanguage([]), "en");
});

test("a saved explicit language overrides browser preference", () => {
    assert.equal(resolveLanguage(["en-US"], "zh-CN"), "zh-CN");
    assert.equal(resolveLanguage(["zh-CN"], "en"), "en");
    assert.equal(resolveLanguage(["zh-CN"], "invalid"), "zh-CN");
});

test("English and Chinese catalogs have the same keys and interpolate values", () => {
    assert.deepEqual(Object.keys(translations["zh-CN"]).sort(), Object.keys(translations.en).sort());
    assert.equal(translate("en", "resource.deleted", { name: "photo.png" }), "photo.png deleted");
    assert.equal(translate("zh-CN", "resource.deleted", { name: "photo.png" }), "photo.png 已删除");
    assert.equal(translate("zh-CN", "nav.files"), "文件");
    assert.equal(translate("fr", "nav.files"), "Files");
    assert.equal(translate("zh-CN", "audit.title"), "内容审计");
    assert.equal(translate("zh-CN", "user.disable"), "禁用账户");
    assert.equal(translate("en", "upload.remoteTab"), "Import file");
    assert.equal(translate("zh-CN", "upload.remoteTab"), "文件外链");
    assert.equal(translate("en", "files.remoteUrl"), "File URL");
    assert.equal(translate("zh-CN", "files.remoteUrl"), "文件外链");
    assert.equal(translate("en", "upload.title"), "Upload & publish");
    assert.equal(translate("zh-CN", "upload.title"), "上传发布");
});

test("every static interface translation marker exists in both catalogs", async () => {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    const keys = [...html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)]
        .map((match) => match[1]);

    assert.ok(keys.length > 40);
    for (const key of keys) {
        assert.ok(Object.hasOwn(translations.en, key), `missing English translation: ${key}`);
        assert.ok(Object.hasOwn(translations["zh-CN"], key), `missing Chinese translation: ${key}`);
    }
});
