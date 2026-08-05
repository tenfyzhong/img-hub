import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resetLocalState } from "../scripts/reset-local.mjs";

test("package scripts expose explicit local-only test and development commands", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const wrangler = JSON.parse(
        (await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"))
            .replace(/^\s*\/\/.*$/gm, ""),
    );

    assert.match(packageJson.scripts["test:local"], /local-tests\/worker\.mjs/);
    assert.match(packageJson.scripts["dev:local"], /wrangler dev --local/);
    assert.equal(packageJson.scripts["local:reset"], "node scripts/reset-local.mjs");
    assert.equal(packageJson.scripts["admin:reset"], "node scripts/reset-admin-password.mjs");
    assert.match(packageJson.scripts["dev:local"], /TURNSTILE_SITE_KEY/);
    assert.match(packageJson.scripts["dev:local"], /TURNSTILE_SECRET_KEY/);
    assert.ok(wrangler.d1_databases.every((binding) => binding.remote !== true));
    assert.ok(wrangler.r2_buckets.every((binding) => binding.remote !== true));
    assert.equal(wrangler.vars?.TURNSTILE_SECRET_KEY, undefined);
});

test("local reset removes only persistent Wrangler state", async (context) => {
    const projectRoot = await mkdtemp(join(tmpdir(), "img-hub-local-reset-"));
    context.after(async () => {
        const { rm } = await import("node:fs/promises");
        await rm(projectRoot, { recursive: true, force: true });
    });
    await mkdir(join(projectRoot, ".wrangler", "state", "v3", "d1"), { recursive: true });
    await mkdir(join(projectRoot, ".wrangler", "tmp"), { recursive: true });
    await writeFile(join(projectRoot, ".wrangler", "state", "v3", "d1", "local.sqlite"), "data");
    await writeFile(join(projectRoot, ".wrangler", "tmp", "keep.txt"), "temporary build");

    assert.equal(await resetLocalState(projectRoot), true);
    await assert.rejects(readFile(join(projectRoot, ".wrangler", "state", "v3", "d1", "local.sqlite")));
    assert.equal(
        await readFile(join(projectRoot, ".wrangler", "tmp", "keep.txt"), "utf8"),
        "temporary build",
    );
    assert.equal(await resetLocalState(projectRoot), false);
});
