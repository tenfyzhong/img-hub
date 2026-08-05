import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_SITE_SETTINGS,
    createSiteSettingsService,
} from "../src/site-settings-service.js";

function memorySettings(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        repository: {
            async get(key) {
                return values.get(key) ?? null;
            },
            async set(key, value) {
                values.set(key, value);
            },
        },
    };
}

test("site settings return safe defaults before an administrator customizes them", async () => {
    const memory = memorySettings();
    const service = createSiteSettingsService(memory.repository);

    assert.deepEqual(await service.get(), DEFAULT_SITE_SETTINGS);
});

test("an administrator can customize the public site title and welcome copy", async () => {
    const memory = memorySettings();
    const service = createSiteSettingsService(memory.repository);
    const updated = await service.update({ role: "admin" }, {
        siteTitle: "Team Gallery",
        siteTagline: "Artifacts for the whole team",
        welcomeTitle: "Upload once, share everywhere.",
        welcomeDescription: "Private workspaces and stable public links.",
    });

    assert.deepEqual(await service.get(), updated);
    assert.equal(memory.values.get("site_title"), "Team Gallery");
    assert.equal(memory.values.get("site_welcome_title"), "Upload once, share everywhere.");
});

test("site settings require an administrator and enforce text limits", async () => {
    const memory = memorySettings();
    const service = createSiteSettingsService(memory.repository);
    const valid = { ...DEFAULT_SITE_SETTINGS };

    await assert.rejects(service.update({ role: "user" }, valid), /administrator/i);
    await assert.rejects(service.update({ role: "admin" }, { ...valid, siteTitle: "" }), /site title/i);
    await assert.rejects(service.update({ role: "admin" }, {
        ...valid,
        welcomeDescription: "x".repeat(241),
    }), /welcome description/i);
    assert.equal(memory.values.size, 0);
});
