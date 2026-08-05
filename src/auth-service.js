import { createSessionToken, hashSessionToken, verifyPassword } from "./auth.js";
import { AppError } from "./errors.js";
import { parseCookies } from "./http.js";

export const SESSION_COOKIE_NAME = "img_hub_session";
export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;

function sessionCookie(token, secure, maxAge = SESSION_DURATION_SECONDS) {
    const attributes = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${maxAge}`,
    ];
    if (secure) {
        attributes.push("Secure");
    }
    return attributes.join("; ");
}

export function clearSessionCookie(secure) {
    return sessionCookie("", secure, 0);
}

export function createAuthService(userRepository, sessionRepository, now = () => new Date()) {
    async function tokenContext(request) {
        const cookieToken = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE_NAME];
        const authorization = request.headers.get("Authorization") || "";
        const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
        const token = cookieToken || bearerToken;
        if (!token) {
            return null;
        }
        return { token, tokenHash: await hashSessionToken(token) };
    }

    return {
        async login(rawUsername, password, secure) {
            const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
            const user = username ? await userRepository.findByUsername(username) : null;
            if (!user || typeof password !== "string" || !await verifyPassword(password, user.passwordHash)) {
                throw new AppError(401, "Invalid username or password", "invalid_credentials");
            }
            if (user.disabled) {
                throw new AppError(403, "This account is disabled", "account_disabled");
            }
            const token = createSessionToken();
            const tokenHash = await hashSessionToken(token);
            const expiresAt = new Date(now().getTime() + SESSION_DURATION_SECONDS * 1000).toISOString();
            await sessionRepository.create({ tokenHash, userId: user.id, expiresAt });
            return { user, token, tokenHash, cookie: sessionCookie(token, secure) };
        },

        async authenticate(request) {
            const context = await tokenContext(request);
            if (!context) {
                return null;
            }
            const user = await sessionRepository.findUserByTokenHash(context.tokenHash);
            if (!user || user.disabled) {
                return null;
            }
            return { user, tokenHash: context.tokenHash, authType: "session" };
        },

        async logout(request, secure) {
            const context = await tokenContext(request);
            if (context) {
                await sessionRepository.delete(context.tokenHash);
            }
            return clearSessionCookie(secure);
        },
    };
}
