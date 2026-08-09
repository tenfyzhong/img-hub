import assert from "node:assert/strict";
import test from "node:test";

import {
    assertPasswordConfirmation,
    hashPassword,
    hashSessionToken,
    validatePassword,
    verifyPassword,
} from "../src/auth.js";

test("password hashes are salted and verifiable", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    assert.match(first, /^pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    assert.equal(Number(first.split("$")[1]), 100000);
    assert.notEqual(first, second);
    assert.equal(await verifyPassword("correct horse battery staple", first), true);
    assert.equal(await verifyPassword("wrong password", first), false);
});

test("password policy rejects short passwords", () => {
    assert.throws(
        () => validatePassword("short"),
        (error) => error.status === 400 && error.code === "invalid_password",
    );
    assert.doesNotThrow(() => validatePassword("long enough password"));
});

test("every password-setting flow requires an exact confirmation", () => {
    assert.doesNotThrow(() => assertPasswordConfirmation("long enough password", "long enough password"));
    assert.throws(
        () => assertPasswordConfirmation("long enough password", "different password"),
        /match/i,
    );
    assert.throws(() => assertPasswordConfirmation("long enough password"), /match/i);
});

test("session tokens are stored as deterministic hashes", async () => {
    assert.equal(await hashSessionToken("session-token"), await hashSessionToken("session-token"));
    assert.notEqual(await hashSessionToken("session-token"), "session-token");
});
