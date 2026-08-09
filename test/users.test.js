import assert from "node:assert/strict";
import test from "node:test";

import { createUserService } from "../src/user-service.js";

function createMemoryUsers() {
    const users = [];
    const revoked = [];
    const reservedUsernames = new Set();
    return {
        users,
        revoked,
        reservedUsernames,
        repository: {
            async create(user) {
                users.push(user);
                return user;
            },
            async findById(id) {
                return users.find((user) => user.id === id) ?? null;
            },
            async findByUsername(username) {
                return users.find((user) => user.username === username) ?? null;
            },
            async isUsernameReserved(username) {
                return reservedUsernames.has(username);
            },
            async updatePassword(id, passwordHash, mustChangePassword) {
                const user = users.find((candidate) => candidate.id === id);
                Object.assign(user, { passwordHash, mustChangePassword });
            },
            async deleteSessions(id, exceptTokenHash = null) {
                revoked.push({ id, exceptTokenHash });
            },
            async setDisabled(id, disabled) {
                const user = users.find((candidate) => candidate.id === id);
                user.disabled = disabled;
                return user;
            },
            async list() {
                return users;
            },
            async listPage(options) {
                const matched = users.filter((user) => user.username.includes(options.query));
                return {
                    items: matched.slice(options.offset, options.offset + options.pageSize),
                    total: matched.length,
                };
            },
        },
    };
}

test("an administrator creates a user with a temporary password", async () => {
    const memory = createMemoryUsers();
    const service = createUserService(memory.repository);
    const admin = { id: "admin", role: "admin" };

    const user = await service.createUser(admin, "alice", "temporary password");

    assert.equal(user.username, "alice");
    assert.equal(user.role, "user");
    assert.equal(user.mustChangePassword, true);
    assert.notEqual(user.passwordHash, "temporary password");
});

test("a non-administrator cannot create or reset users", async () => {
    const memory = createMemoryUsers();
    const service = createUserService(memory.repository);
    const user = { id: "user", role: "user" };

    await assert.rejects(service.createUser(user, "alice", "temporary password"), /administrator/i);
    await assert.rejects(service.resetPassword(user, "target", "replacement password"), /administrator/i);
});

test("an administrator reset marks the password temporary and revokes sessions", async () => {
    const memory = createMemoryUsers();
    memory.users.push({ id: "target", username: "alice", role: "user", mustChangePassword: false });
    const service = createUserService(memory.repository);

    await service.resetPassword({ id: "admin", role: "admin" }, "target", "replacement password");

    assert.equal(memory.users[0].mustChangePassword, true);
    assert.deepEqual(memory.revoked, [{ id: "target", exceptTokenHash: null }]);
});

test("a user changes their password and clears the first-login requirement", async () => {
    const memory = createMemoryUsers();
    const service = createUserService(memory.repository);
    const created = await service.createUser({ id: "admin", role: "admin" }, "alice", "temporary password");

    await service.changePassword(created, "temporary password", "a permanent password", "current-session");

    assert.equal(created.mustChangePassword, false);
    assert.deepEqual(memory.revoked, [{ id: created.id, exceptTokenHash: "current-session" }]);
});

test("usernames are normalized and validated", async () => {
    const memory = createMemoryUsers();
    const service = createUserService(memory.repository);
    const admin = { id: "admin", role: "admin" };

    await assert.rejects(service.createUser(admin, "../alice", "temporary password"), /username/i);
    await assert.rejects(service.createUser(admin, "admin", "temporary password"), /reserved/i);
    memory.reservedUsernames.add("owner");
    await assert.rejects(service.createUser(admin, "owner", "temporary password"), /reserved/i);
    const user = await service.createUser(admin, " Alice ", "temporary password");
    assert.equal(user.username, "alice");
});

test("an administrator disables and re-enables a user while revoking sessions", async () => {
    const memory = createMemoryUsers();
    memory.users.push({ id: "target", username: "alice", role: "user", disabled: false });
    const service = createUserService(memory.repository);

    await assert.rejects(service.setDisabled({ id: "other", role: "user" }, "target", true), /administrator/i);
    const disabled = await service.setDisabled({ id: "admin", role: "admin" }, "target", true);
    assert.equal(disabled.disabled, true);
    assert.deepEqual(memory.revoked, [{ id: "target", exceptTokenHash: null }]);

    const enabled = await service.setDisabled({ id: "admin", role: "admin" }, "target", false);
    assert.equal(enabled.disabled, false);
    assert.equal(memory.revoked.length, 1);
});

test("the administrator account cannot be disabled", async () => {
    const memory = createMemoryUsers();
    memory.users.push({ id: "admin", username: "admin", role: "admin", disabled: false });
    const service = createUserService(memory.repository);

    await assert.rejects(service.setDisabled(memory.users[0], "admin", true), /administrator account/i);
});

test("administrator user management is searched and paginated", async () => {
    const memory = createMemoryUsers();
    memory.users.push(
        { id: "admin", username: "admin", role: "admin" },
        { id: "one", username: "alice-one", role: "user" },
        { id: "two", username: "alice-two", role: "user" },
    );
    const service = createUserService(memory.repository);

    await assert.rejects(
        service.listUsersPage({ id: "one", role: "user" }, { page: 1 }),
        /administrator/i,
    );
    const result = await service.listUsersPage(
        { id: "admin", role: "admin" },
        { page: "2", pageSize: "1", query: " alice " },
    );

    assert.deepEqual(result.items.map((user) => user.username), ["alice-two"]);
    assert.deepEqual(result.pagination, { page: 2, pageSize: 1, total: 2, totalPages: 2 });
});
