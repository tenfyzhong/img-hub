import { AppError } from "./errors.js";
import { sanitizeFileName } from "./paths.js";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const EXTENSIONS = new Map([
    ["application/gzip", ".gz"],
    ["application/json", ".json"],
    ["application/pdf", ".pdf"],
    ["application/wasm", ".wasm"],
    ["application/zip", ".zip"],
    ["audio/mpeg", ".mp3"],
    ["audio/ogg", ".ogg"],
    ["image/avif", ".avif"],
    ["image/gif", ".gif"],
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/svg+xml", ".svg"],
    ["image/webp", ".webp"],
    ["text/csv", ".csv"],
    ["text/html", ".html"],
    ["text/markdown", ".md"],
    ["text/plain", ".txt"],
    ["video/mp4", ".mp4"],
    ["video/webm", ".webm"],
]);

function privateIpv4(hostname) {
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
        return false;
    }
    const [a, b] = parts.map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19));
}

function privateHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
        || host.endsWith(".internal") || privateIpv4(host)
        || host === "::" || host === "::1" || /^f[cd][0-9a-f]*:/i.test(host)
        || /^fe[89ab][0-9a-f]*:/i.test(host) || /^::ffff:/i.test(host);
}

function validateUrl(value, base) {
    let url;
    try {
        url = base ? new URL(value, base) : new URL(value);
    } catch {
        throw new AppError(400, "Remote file URL is invalid", "invalid_remote_url");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new AppError(400, "Remote file URL is not allowed", "invalid_remote_url");
    }
    if (privateHost(url.hostname)) {
        throw new AppError(400, "Remote file host is private or reserved", "private_remote_host");
    }
    return url;
}

function fileName(url, contentType) {
    let candidate = "remote-file";
    try {
        candidate = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || candidate);
    } catch {
        // Keep the safe fallback.
    }
    candidate = sanitizeFileName(candidate);
    if (!/\.[A-Za-z0-9]{1,10}$/.test(candidate)) {
        candidate += EXTENSIONS.get(contentType) || ".bin";
    }
    return candidate;
}

async function readFileBody(response, maxBytes, onProgress) {
    const lengthHeader = response.headers.get("Content-Length");
    const declared = lengthHeader === null ? null : Number(lengthHeader);
    const total = Number.isFinite(declared) && declared > 0 ? declared : null;
    if (total !== null && total > maxBytes) {
        throw new AppError(400, "Remote file is too large", "invalid_size");
    }

    const chunks = [];
    let loaded = 0;
    const report = () => onProgress({
        loaded,
        total,
        percent: total === null ? null : Math.min(100, Math.round((loaded / total) * 100)),
    });
    report();

    const reader = response.body?.getReader();
    if (!reader) {
        const content = await response.arrayBuffer();
        loaded = content.byteLength;
        if (loaded > maxBytes) {
            throw new AppError(400, "Remote file is too large", "invalid_size");
        }
        report();
        return content;
    }

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        loaded += value.byteLength;
        if (loaded > maxBytes) {
            await reader.cancel();
            throw new AppError(400, "Remote file is too large", "invalid_size");
        }
        chunks.push(value);
        report();
    }

    const content = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return content.buffer;
}

export async function fetchRemoteFile(rawUrl, {
    fetchImpl = fetch,
    maxBytes = MAX_FILE_BYTES,
    onProgress = () => {},
} = {}) {
    let url = validateUrl(rawUrl);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const response = await fetchImpl(url.toString(), { redirect: "manual" });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (redirects === MAX_REDIRECTS) {
                throw new AppError(400, "Remote file redirected too many times", "remote_redirect_limit");
            }
            const location = response.headers.get("Location");
            if (!location) throw new AppError(400, "Remote redirect is missing a location", "invalid_remote_url");
            url = validateUrl(location, url);
            continue;
        }
        if (!response.ok) {
            throw new AppError(400, `Remote file returned HTTP ${response.status}`, "remote_fetch_failed");
        }
        const contentType = (response.headers.get("Content-Type") || "application/octet-stream")
            .split(";", 1)[0]
            .trim()
            .toLowerCase() || "application/octet-stream";
        const content = await readFileBody(response, maxBytes, onProgress);
        return {
            content,
            contentType,
            name: fileName(url, contentType),
            size: content.byteLength,
            sourceUrl: url.toString(),
        };
    }
    throw new AppError(400, "Remote file could not be fetched", "remote_fetch_failed");
}
