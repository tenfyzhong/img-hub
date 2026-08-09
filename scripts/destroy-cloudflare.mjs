import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { resolveResourceNames } from "./deployment-config.mjs";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const R2_DELETE_CONCURRENCY = 20;
const NOT_FOUND = Symbol("not-found");

function encodePathSegment(value) {
    return encodeURIComponent(String(value));
}

function encodeR2ObjectKey(key) {
    return String(key).split("/").map(encodePathSegment).join("/");
}

function errorDetails(payload) {
    if (!Array.isArray(payload?.errors)) {
        return "";
    }
    const messages = payload.errors
        .map((error) => String(error?.message || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join("; ");
    return messages ? `: ${messages.slice(0, 500)}` : "";
}

export function expectedDestroyConfirmation(repository) {
    return `DESTROY ${String(repository || "").trim()}`;
}

export function validateDestroyRequest({
    expectedRepository,
    repository,
    confirmation,
    confirmed,
}) {
    const expected = String(expectedRepository || "").trim();
    const suppliedRepository = String(repository || "").trim();
    const suppliedConfirmation = String(confirmation || "").trim();
    if (!expected
        || suppliedRepository !== expected
        || suppliedConfirmation !== expectedDestroyConfirmation(expected)
        || confirmed !== true) {
        throw new Error("Cloudflare destruction refused: the repository and confirmation must match exactly");
    }
    return { repository: expected };
}

export function createCloudflareApi({ accountId, apiToken, fetchImpl = globalThis.fetch }) {
    const normalizedAccountId = String(accountId || "").trim();
    const normalizedApiToken = String(apiToken || "").trim();
    if (!normalizedAccountId || !normalizedApiToken || typeof fetchImpl !== "function") {
        throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
    }
    const accountPath = `/accounts/${encodePathSegment(normalizedAccountId)}`;

    async function request(operation, path, {
        method = "GET",
        query,
        allowNotFound = false,
    } = {}) {
        const url = new URL(`${CLOUDFLARE_API_BASE}${path}`);
        for (const [name, value] of Object.entries(query || {})) {
            if (value !== undefined && value !== null && value !== "") {
                url.searchParams.set(name, String(value));
            }
        }
        const response = await fetchImpl(url.toString(), {
            method,
            headers: {
                Authorization: `Bearer ${normalizedApiToken}`,
                Accept: "application/json",
            },
        });
        const body = await response.text();
        let payload = null;
        if (body) {
            try {
                payload = JSON.parse(body);
            } catch {
                if (response.ok) {
                    throw new Error(`Cloudflare ${operation} returned invalid JSON`);
                }
            }
        }
        if (response.status === 404 && allowNotFound) {
            return NOT_FOUND;
        }
        if (!response.ok || payload?.success === false) {
            throw new Error(
                `Cloudflare ${operation} failed (HTTP ${response.status})${errorDetails(payload)}`,
            );
        }
        return payload?.result ?? null;
    }

    return {
        getR2Bucket(bucketName) {
            return request("read the R2 bucket",
                `${accountPath}/r2/buckets/${encodePathSegment(bucketName)}`,
                { allowNotFound: true }).then((result) => result === NOT_FOUND ? null : result);
        },
        getR2LockRules(bucketName) {
            return request("read R2 bucket lock rules",
                `${accountPath}/r2/buckets/${encodePathSegment(bucketName)}/lock`);
        },
        listR2Objects(bucketName) {
            return request("list R2 objects",
                `${accountPath}/r2/buckets/${encodePathSegment(bucketName)}/objects`,
                { query: { per_page: 1000 } });
        },
        deleteR2Object(bucketName, key) {
            return request("delete an R2 object",
                `${accountPath}/r2/buckets/${encodePathSegment(bucketName)}/objects/`
                + encodeR2ObjectKey(key),
                { method: "DELETE" });
        },
        deleteR2Bucket(bucketName) {
            return request("delete the R2 bucket",
                `${accountPath}/r2/buckets/${encodePathSegment(bucketName)}`,
                { method: "DELETE", allowNotFound: true });
        },
        listD1Databases(databaseName) {
            return request("list D1 databases", `${accountPath}/d1/database`, {
                query: { name: databaseName, per_page: 10000 },
            });
        },
        deleteD1Database(databaseId) {
            return request("delete the D1 database",
                `${accountPath}/d1/database/${encodePathSegment(databaseId)}`,
                { method: "DELETE", allowNotFound: true });
        },
        listTurnstileWidgets(widgetName) {
            return request("list Turnstile widgets", `${accountPath}/challenges/widgets`, {
                query: { filter: `name:${widgetName}`, per_page: 1000 },
            });
        },
        deleteTurnstileWidget(sitekey) {
            return request("delete the Turnstile widget",
                `${accountPath}/challenges/widgets/${encodePathSegment(sitekey)}`,
                { method: "DELETE", allowNotFound: true });
        },
        async deleteWorker(workerName) {
            const result = await request("delete the Worker",
                `${accountPath}/workers/scripts/${encodePathSegment(workerName)}`,
                { method: "DELETE", query: { force: true }, allowNotFound: true });
            return result !== NOT_FOUND;
        },
    };
}

export async function emptyR2Bucket({ bucketName, api, onProgress = () => {} }) {
    let deleted = 0;
    let previousPage = null;
    while (true) {
        const objects = await api.listR2Objects(bucketName);
        if (!Array.isArray(objects)) {
            throw new Error("Cloudflare returned an invalid R2 object list");
        }
        if (objects.length === 0) {
            return deleted;
        }
        const keys = objects.map((object) => object?.key);
        if (keys.some((key) => typeof key !== "string")) {
            throw new Error("Cloudflare returned an R2 object without a key");
        }
        const pageSignature = JSON.stringify(keys);
        if (pageSignature === previousPage) {
            throw new Error("R2 cleanup made no progress; check bucket lock rules and retry");
        }
        previousPage = pageSignature;
        for (let offset = 0; offset < keys.length; offset += R2_DELETE_CONCURRENCY) {
            const batch = keys.slice(offset, offset + R2_DELETE_CONCURRENCY);
            await Promise.all(batch.map((key) => api.deleteR2Object(bucketName, key)));
            deleted += batch.length;
            onProgress(deleted);
        }
    }
}

function exactMatches(items, name) {
    if (!Array.isArray(items)) {
        throw new Error("Cloudflare returned an invalid resource list");
    }
    return items.filter((item) => item?.name === name);
}

export async function destroyCloudflareDeployment({
    environment = process.env,
    api,
    fetchImpl = globalThis.fetch,
    log = console.log,
} = {}) {
    validateDestroyRequest({
        expectedRepository: environment.IMG_HUB_DESTROY_EXPECTED_REPOSITORY,
        repository: environment.IMG_HUB_DESTROY_REPOSITORY,
        confirmation: environment.IMG_HUB_DESTROY_CONFIRMATION,
        confirmed: environment.IMG_HUB_DESTROY_CONFIRMED === "true",
    });

    const cloudflare = api || createCloudflareApi({
        accountId: environment.CLOUDFLARE_ACCOUNT_ID,
        apiToken: environment.CLOUDFLARE_API_TOKEN,
        fetchImpl,
    });
    const { workerName, databaseName, bucketName } = resolveResourceNames(environment);
    const turnstileName = `${workerName}-login`;

    const [bucket, databasePayload, turnstilePayload] = await Promise.all([
        cloudflare.getR2Bucket(bucketName),
        cloudflare.listD1Databases(databaseName),
        cloudflare.listTurnstileWidgets(turnstileName),
    ]);
    const databases = exactMatches(databasePayload, databaseName);
    const turnstileWidgets = exactMatches(turnstilePayload, turnstileName);
    if (databases.length > 1) {
        throw new Error(`Found multiple D1 databases named ${databaseName}; refusing to destroy anything`);
    }
    if (turnstileWidgets.length > 1) {
        throw new Error(
            `Found multiple Turnstile widgets named ${turnstileName}; refusing to destroy anything`,
        );
    }
    if (bucket) {
        const lockConfiguration = await cloudflare.getR2LockRules(bucketName);
        if (!Array.isArray(lockConfiguration?.rules)) {
            throw new Error("Cloudflare returned an invalid R2 bucket lock configuration");
        }
        if (lockConfiguration.rules.length > 0) {
            throw new Error(
                `R2 bucket ${bucketName} has bucket lock rules; remove them before destruction`,
            );
        }
    }

    log("!!! IRREVERSIBLE DESTRUCTION STARTING: no backup or recovery is provided !!!");
    log(`Worker: ${workerName}`);
    log(`R2 bucket and every object: ${bucketName}`);
    log(`D1 database: ${databaseName}`);
    log(`Turnstile widget: ${turnstileName}`);

    const workerDeleted = await cloudflare.deleteWorker(workerName);
    let objectCount = 0;
    let bucketDeleted = false;
    if (bucket) {
        objectCount = await emptyR2Bucket({
            bucketName,
            api: cloudflare,
            onProgress(count) {
                log(`Permanently deleted ${count} R2 object(s)`);
            },
        });
        await cloudflare.deleteR2Bucket(bucketName);
        bucketDeleted = true;
    }

    let databaseDeleted = false;
    if (databases[0]?.uuid) {
        await cloudflare.deleteD1Database(databases[0].uuid);
        databaseDeleted = true;
    }

    let turnstileDeleted = false;
    if (turnstileWidgets[0]?.sitekey) {
        await cloudflare.deleteTurnstileWidget(turnstileWidgets[0].sitekey);
        turnstileDeleted = true;
    }

    log("Cloudflare deployment destruction completed. Deleted data cannot be recovered.");
    return {
        workerDeleted,
        bucketDeleted,
        databaseDeleted,
        turnstileDeleted,
        objectCount,
    };
}

const isMainModule = process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
    destroyCloudflareDeployment().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
