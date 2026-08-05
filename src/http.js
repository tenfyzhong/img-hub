import { AppError } from "./errors.js";
import { normalizeDirectory, sanitizeFileName } from "./paths.js";

export function parseCookies(header = "") {
    return Object.fromEntries(header.split(";").map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) {
            return [part.trim(), ""];
        }
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        try {
            return [key, decodeURIComponent(value)];
        } catch {
            return [key, value];
        }
    }).filter(([key]) => key));
}

export function assertSameOrigin(request) {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        return;
    }
    const origin = request.headers.get("Origin");
    const isExtension = /^(chrome|moz)-extension:\/\//i.test(origin || "");
    if (origin && !isExtension && origin !== new URL(request.url).origin) {
        throw new AppError(403, "Request origin is not allowed", "invalid_origin");
    }
}

export function routePublicResource(pathname) {
    const rawParts = pathname.split("/").filter(Boolean);
    if (!["file", "text"].includes(rawParts[0])) {
        return null;
    }
    try {
        const parts = rawParts.map((part) => decodeURIComponent(part));
        if (parts.length === 2 && /^pub_[a-f0-9]{32}$/.test(parts[1])) {
            return { kind: parts[0], publicId: parts[1] };
        }
        if (parts.length < 3) return null;
        const [kind, username, ...relative] = parts;
        if (!/^[a-z0-9][a-z0-9_-]{2,31}$/i.test(username)) {
            return null;
        }
        const name = relative.pop();
        const directory = relative.join("/");
        if (sanitizeFileName(name) !== name || normalizeDirectory(directory) !== directory) {
            return null;
        }
        return { kind, username, directory, name };
    } catch {
        return null;
    }
}

export function json(data, status = 200, headers = {}) {
    return Response.json(data, {
        status,
        headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...headers,
        },
    });
}

export function progressStream(operation) {
    const encoder = new TextEncoder();
    let open = true;
    const stream = new ReadableStream({
        start(controller) {
            const send = (event) => {
                if (!open) return false;
                try {
                    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
                    return true;
                } catch {
                    open = false;
                    return false;
                }
            };
            Promise.resolve()
                .then(() => operation(send))
                .catch((error) => {
                    if (!(error instanceof AppError)) console.error(error);
                    send({
                        type: "error",
                        error: error instanceof AppError
                            ? { code: error.code, message: error.message, status: error.status }
                            : { code: "internal_error", message: "Internal server error", status: 500 },
                    });
                })
                .finally(() => {
                    if (!open) return;
                    open = false;
                    controller.close();
                });
        },
        cancel() {
            open = false;
        },
    });
    return new Response(stream, {
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

export async function readJson(request) {
    const type = request.headers.get("Content-Type") || "";
    if (!type.toLowerCase().includes("application/json")) {
        throw new AppError(415, "Content-Type must be application/json", "invalid_content_type");
    }
    try {
        return await request.json();
    } catch {
        throw new AppError(400, "Request body is not valid JSON", "invalid_json");
    }
}
