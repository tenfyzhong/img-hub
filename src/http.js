import { AppError } from "./errors.js";

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
    if (rawParts.length !== 2
        || rawParts[0] !== "pub"
        || !/^[0-9a-km-zA-NP-Z]{6,32}$/.test(rawParts[1])) {
        return null;
    }
    return { publicId: rawParts[1] };
}

export function json(data, status = 200, headers = {}) {
    const responseHeaders = new Headers({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    for (const [name, rawValue] of Object.entries(headers)) {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        for (const value of values) responseHeaders.append(name, value);
    }
    return Response.json(data, {
        status,
        headers: responseHeaders,
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
