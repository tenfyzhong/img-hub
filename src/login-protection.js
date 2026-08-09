import { AppError } from "./errors.js";
import { verifyTurnstileToken } from "./turnstile.js";

export const LOGIN_FAILURE_THRESHOLD = 3;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

async function hashIdentifier(username, clientIp) {
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    const value = new TextEncoder().encode(`${normalizedUsername}\0${clientIp || ""}`);
    const digest = await crypto.subtle.digest("SHA-256", value);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function isActive(row, cutoff) {
    return Boolean(row)
        && row.failedCount >= LOGIN_FAILURE_THRESHOLD
        && row.windowStartedAt > cutoff;
}

export function createLoginProtection(repository, {
    siteKey,
    secretKey,
    fetchImpl = fetch,
    now = () => new Date(),
} = {}) {
    return {
        async inspect(request, username, turnstileToken) {
            const clientIp = request.headers.get("CF-Connecting-IP") || null;
            const identifierHash = await hashIdentifier(username, clientIp);
            const currentTime = now();
            const cutoff = new Date(currentTime.getTime() - LOGIN_FAILURE_WINDOW_MS).toISOString();
            const row = await repository.find(identifierHash);
            const attempt = {
                identifierHash,
                clientIp,
                now: currentTime.toISOString(),
                cutoff,
            };
            if (!isActive(row, cutoff)) return attempt;
            if (!siteKey || !secretKey) {
                throw new AppError(503, "Login verification is unavailable", "turnstile_unavailable");
            }
            if (!turnstileToken) {
                throw new AppError(403, "Complete the login verification", "turnstile_required");
            }
            const valid = await verifyTurnstileToken({
                token: turnstileToken,
                secretKey,
                remoteIp: clientIp,
                expectedAction: "login",
                expectedHostname: new URL(request.url).hostname,
                fetchImpl,
            });
            if (!valid) {
                throw new AppError(403, "Login verification failed", "turnstile_failed");
            }
            return attempt;
        },

        async recordFailure(attempt) {
            await repository.deleteExpired(attempt.cutoff);
            const row = await repository.recordFailure(
                attempt.identifierHash,
                attempt.now,
                attempt.cutoff,
            );
            return { turnstileRequired: isActive(row, attempt.cutoff) };
        },

        async clear(attempt) {
            await repository.delete(attempt.identifierHash);
        },
    };
}
