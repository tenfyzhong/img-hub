import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { hashPassword } from "../src/auth.js";

function sqlLiteral(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildAdminResetSql(passwordHash) {
    if (!/^pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(passwordHash)) {
        throw new Error("A valid password hash is required");
    }
    return `CREATE TABLE IF NOT EXISTS username_aliases (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO username_aliases (username, user_id)
SELECT administrator.username, administrator.id
FROM users AS administrator
WHERE administrator.role = 'admin'
    AND administrator.username <> 'admin' COLLATE NOCASE
    AND NOT EXISTS (
        SELECT 1 FROM users AS reserved
        WHERE reserved.username = 'admin' COLLATE NOCASE
            AND reserved.role <> 'admin'
    );
UPDATE users
SET username = 'admin'
WHERE role = 'admin'
    AND NOT EXISTS (
        SELECT 1 FROM users AS reserved
        WHERE reserved.username = 'admin' COLLATE NOCASE
            AND reserved.role <> 'admin'
    );
UPDATE users
SET password_hash = ${sqlLiteral(passwordHash)}, must_change_password = 1
WHERE role = 'admin';
SELECT changes() AS administrators_reset;
SELECT username AS administrator_username FROM users WHERE role = 'admin';
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE role = 'admin');
UPDATE api_keys
SET revoked_at = CURRENT_TIMESTAMP
WHERE user_id IN (SELECT id FROM users WHERE role = 'admin') AND revoked_at IS NULL;`;
}

function defaultWrangler(args) {
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = spawnSync(executable, ["--no-install", "wrangler", ...args], {
        stdio: "inherit",
        env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Wrangler exited with status ${result.status}`);
    }
}

export async function resetAdministratorPassword({
    password,
    remote = false,
    database,
    persistTo,
    runWrangler = defaultWrangler,
} = {}) {
    if (remote && persistTo) {
        throw new Error("--persist-to can only be used for a local reset");
    }
    if (remote && (!database || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(database))) {
        throw new Error("An explicit D1 database name is required for a remote reset");
    }
    const passwordHash = await hashPassword(password);
    const target = remote ? database : "DB";
    const location = remote
        ? ["--remote"]
        : [
            "--local",
            "--config",
            "wrangler.jsonc",
            ...(persistTo ? ["--persist-to", persistTo] : []),
        ];
    runWrangler([
        "d1",
        "execute",
        target,
        ...location,
        "--command",
        buildAdminResetSql(passwordHash),
        "--yes",
    ]);
}

function optionValue(argumentsList, index, option) {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("-")) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

export function parseResetArguments(argumentsList) {
    const options = { remote: false, database: null, persistTo: null, help: false };
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index];
        if (argument === "--remote") {
            options.remote = true;
        } else if (argument === "--database") {
            options.database = optionValue(argumentsList, index, "--database");
            index += 1;
        } else if (argument === "--persist-to") {
            options.persistTo = optionValue(argumentsList, index, "--persist-to");
            index += 1;
        } else if (argument === "--help" || argument === "-h") {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return options;
}

async function readHidden(prompt) {
    if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
        throw new Error("Interactive terminal required; alternatively set IMG_HUB_NEW_ADMIN_PASSWORD");
    }
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    return new Promise((resolve, reject) => {
        let value = "";
        const finish = (error) => {
            process.stdin.off("data", onData);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write("\n");
            if (error) reject(error);
            else resolve(value);
        };
        const onData = (chunk) => {
            for (const character of chunk) {
                if (character === "\u0003") {
                    finish(new Error("Password reset cancelled"));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish();
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    value = value.slice(0, -1);
                } else if (character >= " ") {
                    value += character;
                }
            }
        };
        process.stdin.on("data", onData);
    });
}

async function main() {
    const options = parseResetArguments(process.argv.slice(2));
    if (options.help) {
        console.log("Usage: npm run admin:reset -- [--persist-to <PATH>] [--remote --database <D1_DATABASE_NAME>]");
        console.log("Without --remote, only the persistent local Wrangler D1 database is changed.");
        return;
    }
    if (options.remote && !options.database) {
        throw new Error("Remote reset requires --database <D1_DATABASE_NAME>");
    }
    let password = process.env.IMG_HUB_NEW_ADMIN_PASSWORD || await readHidden("New temporary administrator password: ");
    if (!process.env.IMG_HUB_NEW_ADMIN_PASSWORD) {
        const confirmation = await readHidden("Repeat the temporary password: ");
        if (password !== confirmation) throw new Error("Passwords do not match");
    }
    const location = options.remote ? `remote D1 database ${options.database}` : "local D1 binding DB";
    console.log(`Resetting the administrator in ${location}.`);
    await resetAdministratorPassword({
        password,
        remote: options.remote,
        database: options.database,
        persistTo: options.persistTo,
    });
    password = "";
    delete process.env.IMG_HUB_NEW_ADMIN_PASSWORD;
    console.log("Administrator credentials reset. Sign in and change the temporary password immediately.");
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryPoint === import.meta.url) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
