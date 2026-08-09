import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword } from "../src/auth.js";
import { createAuthService } from "../src/auth-service.js";

async function createFixture() {
    const user = {
        id: "usr_alice",
        username: "alice",
        passwordHash: await hashPassword("temporary password"),
        role: "user",
        mustChangePassword: true,
        disabled: false,
    };
    const sessions = [];
    const refreshSessions = [];
    return {
        user,
        sessions,
        refreshSessions,
        service: createAuthService({
            async findByUsername(username) {
                return username === "alice" ? user : null;
            },
            async findById(id) {
                return id === user.id ? user : null;
            },
        }, {
            async create(session) {
                sessions.push(session);
            },
            async findUserByTokenHash(tokenHash) {
                return sessions.some((session) => session.tokenHash === tokenHash) ? user : null;
            },
            async delete(tokenHash) {
                const index = sessions.findIndex((session) => session.tokenHash === tokenHash);
                if (index >= 0) sessions.splice(index, 1);
            },
        }, {
            async create(refreshSession) {
                refreshSessions.push(refreshSession);
            },
            async consume(tokenHash) {
                const index = refreshSessions.findIndex((session) => session.tokenHash === tokenHash);
                if (index < 0) return null;
                return refreshSessions.splice(index, 1)[0];
            },
            async delete(tokenHash) {
                const index = refreshSessions.findIndex((session) => session.tokenHash === tokenHash);
                if (index >= 0) refreshSessions.splice(index, 1);
            },
            async deleteByAccessTokenHash(accessTokenHash) {
                const index = refreshSessions.findIndex((session) => (
                    session.accessTokenHash === accessTokenHash
                ));
                if (index >= 0) refreshSessions.splice(index, 1);
            },
        }, () => new Date("2026-08-05T00:00:00.000Z")),
    };
}

test("login creates a secure session and reports required first-login password change", async () => {
    const fixture = await createFixture();
    const result = await fixture.service.login(" Alice ", "temporary password", true);

    assert.equal(result.user.mustChangePassword, true);
    assert.equal(fixture.sessions.length, 1);
    assert.equal(fixture.sessions[0].userId, fixture.user.id);
    assert.equal(fixture.sessions[0].expiresAt, "2026-08-12T00:00:00.000Z");
    assert.equal(fixture.refreshSessions.length, 1);
    assert.equal(fixture.refreshSessions[0].expiresAt, "2026-09-04T00:00:00.000Z");
    assert.equal(fixture.refreshSessions[0].accessTokenHash, fixture.sessions[0].tokenHash);
    assert.match(result.cookie, /^img_hub_session=/);
    assert.match(result.refreshCookie, /^img_hub_refresh=/);
    assert.match(result.cookie, /HttpOnly/);
    assert.match(result.refreshCookie, /HttpOnly/);
    assert.match(result.cookie, /SameSite=Strict/);
    assert.match(result.refreshCookie, /SameSite=Strict/);
    assert.match(result.cookie, /Secure/);
    assert.match(result.refreshCookie, /Secure/);
    assert.doesNotMatch(result.cookie, new RegExp(fixture.sessions[0].tokenHash));
});

test("login uses a generic error for unknown users and wrong passwords", async () => {
    const fixture = await createFixture();

    await assert.rejects(fixture.service.login("missing", "temporary password", true), /invalid username or password/i);
    await assert.rejects(fixture.service.login("alice", "incorrect password", true), /invalid username or password/i);
});

test("authenticates and logs out using the session cookie", async () => {
    const fixture = await createFixture();
    const login = await fixture.service.login("alice", "temporary password", false);
    const request = new Request("http://localhost/api/auth/me", {
        headers: { Cookie: login.cookie.split(";")[0] },
    });

    const context = await fixture.service.authenticate(request);
    assert.equal(context.user.id, fixture.user.id);
    const cookies = await fixture.service.logout(request, false);
    assert.equal(fixture.sessions.length, 0);
    assert.equal(fixture.refreshSessions.length, 0);
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every((cookie) => /Max-Age=0/.test(cookie)));
});

test("a refresh token rotates both credentials and cannot be replayed", async () => {
    const fixture = await createFixture();
    const login = await fixture.service.login("alice", "temporary password", true);
    const originalAccessHash = fixture.sessions[0].tokenHash;
    const originalRefreshHash = fixture.refreshSessions[0].tokenHash;
    const request = new Request("https://img.example.com/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: login.refreshCookie.split(";")[0] },
    });

    const refreshed = await fixture.service.refresh(request, true);

    assert.equal(refreshed.user.id, fixture.user.id);
    assert.equal(fixture.sessions.length, 1);
    assert.equal(fixture.refreshSessions.length, 1);
    assert.notEqual(fixture.sessions[0].tokenHash, originalAccessHash);
    assert.notEqual(fixture.refreshSessions[0].tokenHash, originalRefreshHash);
    await assert.rejects(fixture.service.refresh(request, true), /refresh token/i);
});

test("authenticates an extension session using a bearer token", async () => {
    const fixture = await createFixture();
    const login = await fixture.service.login("alice", "temporary password", true, false);
    const request = new Request("https://img.example.com/api/auth/me", {
        headers: { Authorization: `Bearer ${login.token}` },
    });

    const context = await fixture.service.authenticate(request);
    assert.equal(context.user.id, fixture.user.id);
    assert.equal(context.authType, "session");
    assert.equal(fixture.refreshSessions.length, 0);
});

test("disabled users cannot log in", async () => {
    const fixture = await createFixture();
    fixture.user.disabled = true;

    await assert.rejects(fixture.service.login("alice", "temporary password", true), /disabled/i);
});
