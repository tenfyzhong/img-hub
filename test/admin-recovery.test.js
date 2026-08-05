import assert from "node:assert/strict";
import test from "node:test";

import {
    buildAdminResetSql,
    parseResetArguments,
    resetAdministratorPassword,
} from "../scripts/reset-admin-password.mjs";

test("administrator recovery updates the password and revokes every credential", () => {
    const sql = buildAdminResetSql("pbkdf2-sha256$210000$salt$hash");

    assert.match(sql, /UPDATE users[\s\S]*password_hash[\s\S]*must_change_password = 1[\s\S]*role = 'admin'/);
    assert.match(sql, /username = 'admin'/);
    assert.match(sql, /username_aliases/);
    assert.match(sql, /administrator_username/);
    assert.match(sql, /DELETE FROM sessions[\s\S]*role = 'admin'/);
    assert.match(sql, /UPDATE api_keys[\s\S]*revoked_at = CURRENT_TIMESTAMP[\s\S]*role = 'admin'/);
    assert.doesNotMatch(sql, /\b(?:BEGIN|COMMIT|SAVEPOINT)\b/);
    assert.match(sql, /SELECT changes\(\) AS administrators_reset/);
});

test("local administrator recovery uses only the persistent local D1 binding", async () => {
    const calls = [];
    await resetAdministratorPassword({
        password: "new local administrator password",
        persistTo: "/tmp/img-hub-reset-test",
        runWrangler(args) {
            calls.push(args);
        },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ["d1", "execute", "DB"]);
    assert.ok(calls[0].includes("--local"));
    assert.ok(calls[0].includes("--config"));
    assert.ok(calls[0].includes("wrangler.jsonc"));
    assert.deepEqual(
        calls[0].slice(calls[0].indexOf("--persist-to"), calls[0].indexOf("--persist-to") + 2),
        ["--persist-to", "/tmp/img-hub-reset-test"],
    );
    assert.ok(calls[0].includes("--yes"));
    assert.doesNotMatch(calls[0].join(" "), /new local administrator password/);
});

test("remote administrator recovery requires and targets an explicit D1 database", async () => {
    await assert.rejects(
        resetAdministratorPassword({
            password: "new remote administrator password",
            remote: true,
            runWrangler() {},
        }),
        /database/i,
    );

    const calls = [];
    await resetAdministratorPassword({
        password: "new remote administrator password",
        remote: true,
        database: "img-hub-123-db",
        runWrangler(args) {
            calls.push(args);
        },
    });

    assert.deepEqual(calls[0].slice(0, 3), ["d1", "execute", "img-hub-123-db"]);
    assert.ok(calls[0].includes("--remote"));
    assert.ok(!calls[0].includes("--local"));
    assert.doesNotMatch(calls[0].join(" "), /new remote administrator password/);
});

test("administrator recovery rejects ambiguous command targets", async () => {
    assert.throws(() => parseResetArguments(["--database"]), /database/i);
    assert.throws(() => parseResetArguments(["--persist-to"]), /persist/i);
    assert.throws(() => parseResetArguments(["--database", "--remote"]), /database/i);
    await assert.rejects(
        resetAdministratorPassword({
            password: "new remote administrator password",
            remote: true,
            database: "img-hub-db",
            persistTo: "/tmp/not-a-remote-target",
            runWrangler() {},
        }),
        /persist/i,
    );
});
