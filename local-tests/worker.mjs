import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { unstable_dev } from "wrangler";

process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";

function jsonRequest(method, body, cookie) {
    return {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
    };
}

function responseCookies(response) {
    const values = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : String(response.headers.get("Set-Cookie") || "").split(/,\s*(?=[^;,]+=)/);
    return Object.fromEntries(values.filter(Boolean).map((value) => {
        const pair = value.split(";", 1)[0];
        return [pair.slice(0, pair.indexOf("=")), pair];
    }));
}

function cookieHeader(cookies) {
    return Object.values(cookies).join("; ");
}

test("the complete Worker uses only local D1, R2, assets, and cache simulations", async (context) => {
    const worker = await unstable_dev("src/index.js", {
        config: "wrangler.jsonc",
        local: true,
        persist: false,
        vars: {
            TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
            TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        },
        logLevel: "none",
        experimental: {
            disableExperimentalWarning: true,
            showInteractiveDevSession: false,
            watch: false,
        },
    });
    context.after(() => worker.stop());
    const localOrigin = `http://${worker.address}:${worker.port}`;

    const initial = await worker.fetch("/api/setup/status").then((response) => response.json());
    assert.equal(initial.initialized, false);
    assert.equal(initial.turnstileSiteKey, "1x00000000000000000000AA");

    for (let count = 1; count <= 3; count += 1) {
        const failedLogin = await worker.fetch("/api/auth/login", jsonRequest("POST", {
            username: "unknown-user",
            password: "invalid password",
        }));
        assert.equal(failedLogin.status, count === 3 ? 403 : 401);
        assert.equal((await failedLogin.json()).error.code,
            count === 3 ? "turnstile_required" : "invalid_credentials");
    }

    const mismatchedSetup = await worker.fetch("/api/setup", jsonRequest("POST", {
        password: "local test password",
        confirmPassword: "different local password",
    }));
    assert.equal(mismatchedSetup.status, 400);
    assert.equal((await worker.fetch("/api/setup/status").then((response) => response.json())).initialized, false);

    const setupResponse = await worker.fetch("/api/setup", jsonRequest("POST", {
        username: "localadmin",
        password: "local test password",
        confirmPassword: "local test password",
    }));
    assert.equal(setupResponse.status, 201);
    assert.equal((await setupResponse.clone().json()).user.username, "admin");
    const setupCookies = responseCookies(setupResponse);
    assert.ok(setupCookies.img_hub_session);
    assert.ok(setupCookies.img_hub_refresh);
    const refreshResponse = await worker.fetch("/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: cookieHeader(setupCookies) },
    });
    assert.equal(refreshResponse.status, 200);
    const refreshedCookies = responseCookies(refreshResponse);
    assert.notEqual(refreshedCookies.img_hub_session, setupCookies.img_hub_session);
    assert.notEqual(refreshedCookies.img_hub_refresh, setupCookies.img_hub_refresh);
    assert.equal((await worker.fetch("/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: setupCookies.img_hub_refresh },
    })).status, 401);
    const cookie = refreshedCookies.img_hub_session;

    const form = new FormData();
    form.set("directory", "integration");
    const sampleBytes = new Uint8Array([137, 80, 78, 71]);
    const sampleMd5 = createHash("md5").update(sampleBytes).digest("hex");
    form.set("file", new File([sampleBytes], "sample.png", { type: "image/png" }));
    form.set("md5", sampleMd5);
    const uploadResponse = await fetch(`${localOrigin}/api/files`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
    });
    assert.equal(uploadResponse.status, 201);
    const uploaded = await uploadResponse.json();
    const publicPath = new URL(uploaded.resource.url).pathname + new URL(uploaded.resource.url).search;
    assert.match(new URL(uploaded.resource.url).pathname, /^\/pub\/[0-9a-km-zA-NP-Z]{6}$/);
    assert.match(uploaded.resource.name, /^sample-\d{8}T\d{9}\.png$/);
    assert.doesNotMatch(uploaded.resource.url, /admin|integration|sample\.png/i);

    const instantResponse = await worker.fetch("/api/files/instant", jsonRequest("POST", {
        directory: "integration",
        md5: sampleMd5,
        name: "sample-copy.png",
        size: sampleBytes.byteLength,
    }, cookie));
    assert.equal(instantResponse.status, 200);
    const instant = await instantResponse.json();
    assert.equal(instant.instant, true);
    assert.notEqual(instant.resource.id, uploaded.resource.id);
    assert.match(instant.resource.name, /^sample-copy-\d{8}T\d{9}\.png$/);
    assert.equal((await worker.fetch(new URL(instant.resource.url).pathname
        + new URL(instant.resource.url).search)).status, 200);

    const firstRead = await worker.fetch(publicPath);
    assert.equal(firstRead.status, 200);
    assert.equal(firstRead.headers.get("X-ImgHub-Cache"), "MISS");
    const secondRead = await worker.fetch(publicPath);
    assert.equal(secondRead.headers.get("X-ImgHub-Cache"), "HIT");
    const missingRead = await worker.fetch("/pub/00000000000000000000000000000000?v=1", {
        headers: { "Accept-Language": "zh-CN" },
    });
    assert.equal(missingRead.status, 404);
    assert.match(missingRead.headers.get("Content-Type"), /^text\/html/);
    assert.match(await missingRead.text(), /这个资源不存在/);
    const retiredRead = await worker.fetch(publicPath.replace("/pub/", "/file/"));
    assert.equal(retiredRead.status, 404);
    assert.match(retiredRead.headers.get("Content-Type"), /^text\/html/);
    const adminHistory = await worker.fetch("/api/history", { headers: { Cookie: cookie } })
        .then((response) => response.json());
    assert.equal(adminHistory.events[0].action, "upload");

    const auditResponse = await worker.fetch("/api/admin/resources", { headers: { Cookie: cookie } });
    assert.equal(auditResponse.status, 200);
    const audit = await auditResponse.json();
    assert.ok(audit.pagination.total >= 2);
    const uploadedAudit = audit.resources.find((resource) => resource.id === uploaded.resource.id);
    assert.equal(uploadedAudit.ownerUsername, "admin");
    assert.equal(
        new URL(uploadedAudit.url).pathname + new URL(uploadedAudit.url).search,
        publicPath,
    );
    const searchedAudit = await worker.fetch(
        "/api/admin/resources?q=sample-copy&page=1&pageSize=1",
        { headers: { Cookie: cookie } },
    ).then((response) => response.json());
    assert.equal(searchedAudit.resources.length, 1);
    assert.equal(searchedAudit.pagination.pageSize, 1);
    assert.equal(searchedAudit.pagination.total, 1);

    const blockResponse = await worker.fetch(`/api/admin/resources/${uploaded.resource.id}/block`, {
        method: "POST",
        headers: { Cookie: cookie },
    });
    assert.equal(blockResponse.status, 200);
    const blockedRead = await worker.fetch(publicPath);
    assert.equal(blockedRead.status, 404);
    const blockedAudit = await worker.fetch("/api/admin/resources", { headers: { Cookie: cookie } })
        .then((response) => response.json());
    const blockedResource = blockedAudit.resources.find((resource) => resource.id === uploaded.resource.id);
    assert.ok(blockedResource.blockedAt);
    assert.equal(blockedResource.blockedByUsername, "admin");

    const createUserResponse = await worker.fetch("/api/admin/users", jsonRequest("POST", {
        username: "localuser",
        password: "local temporary password",
        confirmPassword: "local temporary password",
    }, cookie));
    assert.equal(createUserResponse.status, 201);
    const createdUser = await createUserResponse.json();
    const searchedUsers = await worker.fetch(
        "/api/admin/users?q=local&page=1&pageSize=1",
        { headers: { Cookie: cookie } },
    ).then((response) => response.json());
    assert.deepEqual(searchedUsers.users.map((user) => user.username), ["localuser"]);
    assert.deepEqual(searchedUsers.pagination, {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
    });
    const userLogin = await worker.fetch("/api/auth/login", jsonRequest("POST", {
        username: "localuser",
        password: "local temporary password",
    }));
    const userCookie = userLogin.headers.get("Set-Cookie").split(";", 1)[0];
    const passwordResponse = await worker.fetch("/api/auth/password", jsonRequest("POST", {
        currentPassword: "local temporary password",
        newPassword: "local permanent password",
        confirmPassword: "local permanent password",
    }, userCookie));
    assert.equal(passwordResponse.status, 200);
    const apiKeyResponse = await worker.fetch("/api/api-keys", jsonRequest("POST", {
        name: "local integration key",
    }, userCookie));
    assert.equal(apiKeyResponse.status, 201);
    const apiKey = await apiKeyResponse.json();
    const userTextResponse = await worker.fetch("/api/texts", jsonRequest("POST", {
        name: "",
        content: "# Visible while the account is enabled",
        format: "markdown",
    }, userCookie));
    assert.equal(userTextResponse.status, 201);
    const userText = await userTextResponse.json();
    assert.match(userText.resource.name, /^text-\d{8}T\d{9}\.md$/);
    assert.match(new URL(userText.resource.url).pathname, /^\/pub\/[0-9a-km-zA-NP-Z]{6}$/);
    const userTextPath = new URL(userText.resource.url).pathname + new URL(userText.resource.url).search;
    const renderedText = await worker.fetch(userTextPath);
    assert.equal(renderedText.status, 200);
    assert.match(renderedText.headers.get("Content-Type"), /^text\/html/);
    assert.match(await renderedText.text(), /<h1>Visible while the account is enabled<\/h1>/);
    assert.equal((await worker.fetch(userTextPath)).headers.get("X-ImgHub-Cache"), "HIT");

    const disableResponse = await worker.fetch(
        `/api/admin/users/${createdUser.user.id}/status`,
        jsonRequest("PUT", { disabled: true }, cookie),
    );
    assert.equal(disableResponse.status, 200);
    assert.equal((await disableResponse.json()).user.disabled, true);
    assert.equal((await worker.fetch("/api/auth/me", { headers: { Cookie: userCookie } })).status, 401);
    assert.equal((await worker.fetch("/api/resources", {
        headers: { Authorization: `Bearer ${apiKey.token}` },
    })).status, 401);
    assert.equal((await worker.fetch(userTextPath)).status, 404);

    const enableResponse = await worker.fetch(
        `/api/admin/users/${createdUser.user.id}/status`,
        jsonRequest("PUT", { disabled: false }, cookie),
    );
    assert.equal(enableResponse.status, 200);
    const enabledLogin = await worker.fetch("/api/auth/login", jsonRequest("POST", {
        username: "localuser",
        password: "local permanent password",
    }));
    assert.equal(enabledLogin.status, 200);

    const settingsResponse = await worker.fetch("/api/admin/site-settings", jsonRequest("PUT", {
        siteTitle: "Local Gallery",
        siteTagline: "No remote resources",
        welcomeTitle: "Everything runs on this machine.",
        welcomeDescription: "D1, R2, assets, and cache are simulated locally.",
    }, cookie));
    assert.equal(settingsResponse.status, 200);
    const publicSettings = await worker.fetch("/api/site-settings").then((response) => response.json());
    assert.equal(publicSettings.site.siteTitle, "Local Gallery");

    const defaultRetention = await worker.fetch("/api/admin/retention", {
        headers: { cookie },
    }).then((response) => response.json());
    assert.equal(defaultRetention.retention.retentionDays, 91);
    const retentionResponse = await worker.fetch("/api/admin/retention", jsonRequest("PUT", {
        retentionDays: 45,
    }, cookie));
    assert.equal(retentionResponse.status, 200);
    const savedRetention = await retentionResponse.json();
    assert.equal(savedRetention.retention.retentionDays, 45);
});
