import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
    createDeploymentConfig,
    findDatabaseId,
    resolveResourceNames,
} from "./deployment-config.mjs";
import {
    ensureTurnstileWidgetWithWrangler,
    findWorkerHostname,
    normalizeTurnstileDomains,
} from "./turnstile-wrangler.mjs";

const { databaseName, bucketName, workerName } = resolveResourceNames(process.env);
const retentionDays = Number(process.env.IMG_HUB_RETENTION_DAYS || 91);
const generatedConfig = "wrangler.generated.json";
const executable = process.platform === "win32" ? "npx.cmd" : "npx";

if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("IMG_HUB_RETENTION_DAYS must be an integer between 1 and 3650");
}

function wrangler(args, { capture = false, allowFailure = false, silent = false } = {}) {
    const result = spawnSync(executable, ["--no-install", "wrangler", ...args], {
        encoding: "utf8",
        env: process.env,
        stdio: capture || silent ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0 && !allowFailure) {
        if (result.stderr) process.stderr.write(result.stderr);
        throw new Error(`wrangler ${args.join(" ")} failed with exit code ${result.status}`);
    }
    return { ok: result.status === 0, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function readDatabases() {
    const output = wrangler(["d1", "list", "--json"], { capture: true }).stdout;
    return JSON.parse(output);
}

console.log("[1/8] Checking Cloudflare authentication");
wrangler(["whoami"]);

console.log(`[2/8] Provisioning D1 database: ${databaseName}`);
let databaseId = findDatabaseId(readDatabases(), databaseName);
if (!databaseId) {
    const locationArguments = process.env.IMG_HUB_D1_LOCATION
        ? ["--location", process.env.IMG_HUB_D1_LOCATION]
        : [];
    wrangler(["d1", "create", databaseName, ...locationArguments]);
    databaseId = findDatabaseId(readDatabases(), databaseName);
}
if (!databaseId) {
    throw new Error(`Could not resolve the ID of D1 database ${databaseName}`);
}

console.log(`[3/8] Provisioning R2 bucket: ${bucketName}`);
const bucket = wrangler(["r2", "bucket", "info", bucketName, "--json"], {
    capture: true,
    allowFailure: true,
    silent: true,
});
if (!bucket.ok) {
    const locationArguments = process.env.IMG_HUB_R2_LOCATION
        ? ["--location", process.env.IMG_HUB_R2_LOCATION]
        : [];
    wrangler(["r2", "bucket", "create", bucketName, ...locationArguments]);
}

console.log("[4/8] Generating Cloudflare bindings");
let config = createDeploymentConfig({
    databaseId,
    databaseName,
    bucketName,
    workerName,
});
writeFileSync(generatedConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

console.log("[5/8] Applying D1 migrations");
wrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", generatedConfig]);

console.log(`[6/8] Setting the managed R2 lifecycle rule to ${retentionDays} days`);
wrangler([
    "r2", "bucket", "lifecycle", "remove", bucketName,
    "--id", "img-hub-default-expiration",
], { allowFailure: true, silent: true });
wrangler([
    "r2", "bucket", "lifecycle", "add", bucketName,
    "img-hub-default-expiration", "users/",
    "--expire-days", String(retentionDays), "--force",
]);

console.log("[7/8] Provisioning Cloudflare Turnstile login verification");
let turnstileDomains = normalizeTurnstileDomains(process.env.IMG_HUB_TURNSTILE_DOMAINS);
if (turnstileDomains.length === 0) {
    const bootstrap = wrangler(["deploy", "--config", generatedConfig], { capture: true });
    if (bootstrap.stdout) process.stdout.write(bootstrap.stdout);
    const workerHostname = findWorkerHostname(`${bootstrap.stdout}\n${bootstrap.stderr}`);
    if (!workerHostname) {
        throw new Error("Could not determine the workers.dev hostname; set IMG_HUB_TURNSTILE_DOMAINS");
    }
    turnstileDomains = [workerHostname];
}
const turnstile = ensureTurnstileWidgetWithWrangler({
    name: `${workerName}-login`,
    domains: turnstileDomains,
    wrangler,
});
config = createDeploymentConfig({
    databaseId,
    databaseName,
    bucketName,
    workerName,
    turnstileSiteKey: turnstile.siteKey,
});
writeFileSync(generatedConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

console.log(`[8/8] Deploying ImgHub Worker with its Turnstile secret: ${workerName}`);
const secretsDirectory = mkdtempSync(join(tmpdir(), "img-hub-deploy-"));
const secretsFile = join(secretsDirectory, "secrets.json");
try {
    writeFileSync(secretsFile, `${JSON.stringify({
        TURNSTILE_SECRET_KEY: turnstile.secretKey,
    })}\n`, { mode: 0o600 });
    wrangler(["deploy", "--config", generatedConfig, "--secrets-file", secretsFile]);
} finally {
    rmSync(secretsDirectory, { recursive: true, force: true });
}
console.log("Deployment complete. Open the Worker URL and create the first administrator.");
