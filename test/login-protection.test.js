import assert from "node:assert/strict";
import test from "node:test";

import {
    LOGIN_FAILURE_THRESHOLD,
    createLoginProtection,
} from "../src/login-protection.js";
import { verifyTurnstileToken } from "../src/turnstile.js";

function createRepository() {
    const rows = new Map();
    return {
        rows,
        async find(identifierHash) {
            return rows.get(identifierHash) || null;
        },
        async recordFailure(identifierHash, now, cutoff) {
            const current = rows.get(identifierHash);
            const stale = !current || current.windowStartedAt <= cutoff;
            const row = {
                identifierHash,
                failedCount: stale ? 1 : current.failedCount + 1,
                windowStartedAt: stale ? now : current.windowStartedAt,
                updatedAt: now,
            };
            rows.set(identifierHash, row);
            return row;
        },
        async delete(identifierHash) {
            rows.delete(identifierHash);
        },
        async deleteExpired(cutoff) {
            for (const [identifierHash, row] of rows) {
                if (row.updatedAt <= cutoff) rows.delete(identifierHash);
            }
        },
    };
}

function request(headers = {}) {
    return new Request("https://images.example.com/api/auth/login", { headers });
}

test("three failed logins require Turnstile without storing a username or IP address", async () => {
    const repository = createRepository();
    const protection = createLoginProtection(repository, {
        siteKey: "site-key",
        secretKey: "secret-key",
        now: () => new Date("2026-08-06T10:00:00.000Z"),
    });

    let attempt;
    for (let count = 1; count <= LOGIN_FAILURE_THRESHOLD; count += 1) {
        attempt = await protection.inspect(request({ "CF-Connecting-IP": "203.0.113.8" }), " Alice ");
        assert.equal((await protection.recordFailure(attempt)).turnstileRequired,
            count === LOGIN_FAILURE_THRESHOLD);
    }

    assert.equal(repository.rows.size, 1);
    const [identifierHash] = repository.rows.keys();
    assert.match(identifierHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(identifierHash, /alice|203\.0\.113\.8/i);

    await assert.rejects(
        protection.inspect(request({ "CF-Connecting-IP": "203.0.113.8" }), "alice"),
        (error) => error.status === 403 && error.code === "turnstile_required",
    );
});

test("a valid Turnstile token permits another password attempt and successful login clears failures", async () => {
    const repository = createRepository();
    const calls = [];
    const protection = createLoginProtection(repository, {
        siteKey: "site-key",
        secretKey: "secret-key",
        now: () => new Date("2026-08-06T10:00:00.000Z"),
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return Response.json({
                success: true,
                action: "login",
                hostname: "images.example.com",
            });
        },
    });
    let attempt = await protection.inspect(request(), "alice");
    for (let count = 0; count < LOGIN_FAILURE_THRESHOLD; count += 1) {
        await protection.recordFailure(attempt);
        attempt = { ...attempt };
    }

    attempt = await protection.inspect(request(), "alice", "verified-token");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.secret, "secret-key");
    assert.equal(payload.response, "verified-token");
    assert.equal(payload.remoteip ?? null, null);
    assert.equal(payload.idempotency_key.length, 36);

    await protection.clear(attempt);
    assert.equal(repository.rows.size, 0);
});

test("Turnstile validation fails closed for invalid, replayed, wrong-action, and wrong-host tokens", async () => {
    for (const result of [
        { success: false, "error-codes": ["timeout-or-duplicate"] },
        { success: true, action: "upload", hostname: "images.example.com" },
        { success: true, action: "login", hostname: "other.example.com" },
    ]) {
        assert.equal(await verifyTurnstileToken({
            token: "token",
            secretKey: "secret",
            expectedAction: "login",
            expectedHostname: "images.example.com",
            fetchImpl: async () => Response.json(result),
        }), false);
    }

    assert.equal(await verifyTurnstileToken({
        token: "x".repeat(2049),
        secretKey: "secret",
        fetchImpl: async () => assert.fail("oversized tokens must not reach Siteverify"),
    }), false);
});

test("expired login failure windows start over without requiring Turnstile", async () => {
    const repository = createRepository();
    let currentTime = new Date("2026-08-06T10:00:00.000Z");
    const protection = createLoginProtection(repository, {
        siteKey: "site-key",
        secretKey: "secret-key",
        now: () => currentTime,
    });

    let attempt = await protection.inspect(request(), "alice");
    for (let count = 0; count < LOGIN_FAILURE_THRESHOLD; count += 1) {
        await protection.recordFailure(attempt);
    }
    currentTime = new Date("2026-08-06T10:16:00.000Z");
    attempt = await protection.inspect(request(), "alice");
    assert.equal((await protection.recordFailure(attempt)).turnstileRequired, false);
});

test("recording a failure removes expired counters to bound D1 growth", async () => {
    const repository = createRepository();
    repository.rows.set("expired", {
        identifierHash: "expired",
        failedCount: 1,
        windowStartedAt: "2026-08-06T09:00:00.000Z",
        updatedAt: "2026-08-06T09:00:00.000Z",
    });
    const protection = createLoginProtection(repository, {
        siteKey: "site-key",
        secretKey: "secret-key",
        now: () => new Date("2026-08-06T10:00:00.000Z"),
    });

    const attempt = await protection.inspect(request(), "alice");
    await protection.recordFailure(attempt);
    assert.equal(repository.rows.has("expired"), false);
    assert.equal(repository.rows.size, 1);
});
