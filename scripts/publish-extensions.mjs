import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requiredVariables = {
    chrome: [
        "CHROME_PUBLISHER_ID",
        "CHROME_EXTENSION_ID",
        "CHROME_CLIENT_ID",
        "CHROME_CLIENT_SECRET",
        "CHROME_REFRESH_TOKEN",
    ],
    edge: ["EDGE_PRODUCT_ID", "EDGE_CLIENT_ID", "EDGE_API_KEY"],
    firefox: ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"],
};

export function getStoreConfiguration(environment = process.env) {
    return Object.fromEntries(Object.entries(requiredVariables).map(([store, names]) => [
        store,
        names.every((name) => Boolean(environment[name])),
    ]));
}

async function parseResponse(response, operation) {
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!response.ok) {
        throw new Error(`${operation} failed (${response.status}): ${text || response.statusText}`);
    }
    return payload;
}

async function waitForChromeUpload(upload, itemUrl, token, request) {
    let status = upload;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (status?.uploadState === "SUCCESS") return status;
        if (status?.uploadState !== "UPLOAD_IN_PROGRESS") {
            throw new Error(`Chrome rejected the extension upload: ${JSON.stringify(status)}`);
        }
        if (attempt > 0) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
        }
        status = await parseResponse(await request(`${itemUrl}:fetchStatus`, {
            headers: { Authorization: `Bearer ${token}` },
        }), "Chrome extension upload status");
    }
    throw new Error("Timed out waiting for the Chrome extension upload");
}

export async function publishChrome(environment, chromiumPackage, request = fetch) {
    const tokenResponse = await request("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: environment.CHROME_CLIENT_ID,
            client_secret: environment.CHROME_CLIENT_SECRET,
            refresh_token: environment.CHROME_REFRESH_TOKEN,
            grant_type: "refresh_token",
        }),
    });
    const token = await parseResponse(tokenResponse, "Chrome OAuth token refresh");
    if (!token?.access_token) {
        throw new Error("Chrome OAuth token refresh returned no access_token");
    }
    const base = "https://chromewebstore.googleapis.com";
    const item = `publishers/${encodeURIComponent(environment.CHROME_PUBLISHER_ID)}`
        + `/items/${encodeURIComponent(environment.CHROME_EXTENSION_ID)}`;
    const uploadResponse = await request(`${base}/upload/v2/${item}:upload`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token.access_token}`,
            "Content-Type": "application/zip",
        },
        body: await readFile(chromiumPackage),
    });
    const upload = await parseResponse(uploadResponse, "Chrome extension upload");
    await waitForChromeUpload(upload, `${base}/v2/${item}`, token.access_token, request);
    await parseResponse(await request(`${base}/v2/${item}:publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token.access_token}` },
    }), "Chrome extension publish");
}

function edgeHeaders(environment, extra = {}) {
    return {
        Authorization: `ApiKey ${environment.EDGE_API_KEY}`,
        "X-ClientID": environment.EDGE_CLIENT_ID,
        ...extra,
    };
}

async function waitForEdge(location, environment, request = fetch) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (attempt > 0) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000));
        }
        const response = await request(location, { headers: edgeHeaders(environment) });
        const operation = await parseResponse(response, "Edge extension operation");
        const status = String(operation?.status || "").toLowerCase();
        if (status === "succeeded") return operation;
        if (["failed", "cancelled"].includes(status)) {
            throw new Error(`Edge extension operation ${status}: ${JSON.stringify(operation)}`);
        }
    }
    throw new Error("Timed out waiting for the Edge extension operation");
}

async function edgeOperation(response, operation, operationBase, environment, request) {
    await parseResponse(response, operation);
    const location = response.headers.get("Location");
    if (!location) {
        throw new Error(`${operation} returned no Location header`);
    }
    const statusUrl = /^https?:\/\//i.test(location)
        ? location
        : `${operationBase}/${encodeURIComponent(location)}`;
    await waitForEdge(statusUrl, environment, request);
}

export async function publishEdge(environment, chromiumPackage, request = fetch) {
    const base = "https://api.addons.microsoftedge.microsoft.com/v1/products/"
        + encodeURIComponent(environment.EDGE_PRODUCT_ID);
    await edgeOperation(await request(`${base}/submissions/draft/package`, {
        method: "POST",
        headers: edgeHeaders(environment, { "Content-Type": "application/zip" }),
        body: await readFile(chromiumPackage),
    }), "Edge extension upload", `${base}/submissions/draft/package/operations`, environment, request);
    await edgeOperation(await request(`${base}/submissions`, {
        method: "POST",
        headers: edgeHeaders(environment, { "Content-Type": "application/json" }),
        body: JSON.stringify({
            notes: environment.EDGE_PUBLISH_NOTES || "Automated ImgHub extension release",
        }),
    }), "Edge extension publish", `${base}/submissions/operations`, environment, request);
}

function publishFirefox(environment, firefoxDirectory) {
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = spawnSync(executable, [
        "--yes",
        "web-ext@10",
        "sign",
        "--source-dir", firefoxDirectory,
        "--artifacts-dir", resolve("dist/extensions/firefox-signed"),
        "--channel", "listed",
    ], { stdio: "inherit", env: environment });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Firefox extension publish failed with exit code ${result.status}`);
    }
}

export async function publishConfiguredStores({
    environment = process.env,
    request = fetch,
    projectDirectory = process.cwd(),
} = {}) {
    const packageJson = JSON.parse(await readFile(resolve(projectDirectory, "package.json"), "utf8"));
    const base = resolve(projectDirectory, "dist", "extensions");
    const version = String(environment.IMG_HUB_EXTENSION_VERSION || packageJson.version).replace(/^v(?=\d)/, "");
    const chromePackage = resolve(base, `img-hub-extension-chrome-v${version}.zip`);
    const edgePackage = resolve(base, `img-hub-extension-edge-v${version}.zip`);
    const firefoxDirectory = resolve(base, "firefox");
    const configured = getStoreConfiguration(environment);
    const published = [];

    if (configured.chrome) {
        await publishChrome(environment, chromePackage, request);
        published.push("Chrome");
    }
    if (configured.edge) {
        await publishEdge(environment, edgePackage, request);
        published.push("Edge");
    }
    if (configured.firefox) {
        publishFirefox(environment, firefoxDirectory);
        published.push("Firefox");
    }
    return { configured, published };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const result = await publishConfiguredStores();
    if (result.published.length) {
        console.log(`Published extension to: ${result.published.join(", ")}`);
    } else {
        console.log("No complete browser store credential set found; skipping store publication.");
    }
}
