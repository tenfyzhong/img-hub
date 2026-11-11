import { AppError, requireAdministrator } from "./errors.js";

const SETTINGS_KEY = "wechat_verification";
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.txt$/;

export function isVerificationPath(pathname) {
    return pathname.startsWith("/") && SAFE_FILENAME.test(pathname.slice(1));
}

function validate(input) {
    const filename = input?.filename;
    const content = input?.content;
    if (typeof filename !== "string" || typeof content !== "string"
        || (filename === "" ? content !== "" : (
            !SAFE_FILENAME.test(filename)
            || filename.toLowerCase() === "robots.txt"
            || content.length === 0
            || content.length > 4096
        ))) {
        throw new AppError(400, "Provide a safe .txt filename and 1–4096 characters of content, or clear both fields", "invalid_wechat_verification");
    }
    return { filename, content };
}

export function createWechatVerificationService(repository) {
    async function read() {
        const stored = await repository.get(SETTINGS_KEY);
        return stored ? JSON.parse(stored) : { filename: "", content: "" };
    }

    return {
        async get(user) {
            requireAdministrator(user);
            return read();
        },
        async update(user, input) {
            requireAdministrator(user);
            const verification = validate(input);
            // One setting keeps the filename and exact content atomic.
            await repository.set(SETTINGS_KEY, JSON.stringify(verification));
            return verification;
        },
        async serve(request) {
            const path = new URL(request.url).pathname;
            if (!isVerificationPath(path)) return null;
            const verification = await read();
            if (!verification.filename || path !== `/${verification.filename}`) return null;
            const headers = {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            };
            if (!["GET", "HEAD"].includes(request.method)) {
                return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
            }
            return new Response(request.method === "HEAD" ? null : verification.content, { headers });
        },
    };
}
