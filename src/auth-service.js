import { createSessionToken, hashSessionToken, verifyPassword } from "./auth.js";
import { AppError } from "./errors.js";
import { parseCookies } from "./http.js";

export const SESSION_COOKIE_NAME = "img_hub_session";
export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_COOKIE_NAME = "img_hub_refresh";
export const REFRESH_DURATION_SECONDS = 30 * 24 * 60 * 60;

function tokenCookie(name, token, secure, maxAge, path = "/") {
    const attributes = [
        `${name}=${encodeURIComponent(token)}`,
        `Path=${path}`,
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${maxAge}`,
    ];
    if (secure) {
        attributes.push("Secure");
    }
    return attributes.join("; ");
}

function sessionCookie(token, secure, maxAge = SESSION_DURATION_SECONDS) {
    return tokenCookie(SESSION_COOKIE_NAME, token, secure, maxAge);
}

function refreshCookie(token, secure, maxAge = REFRESH_DURATION_SECONDS) {
    return tokenCookie(REFRESH_COOKIE_NAME, token, secure, maxAge, "/api/auth");
}

export function clearSessionCookies(secure) {
    return [sessionCookie("", secure, 0), refreshCookie("", secure, 0)];
}

export function createAuthService(
    userRepository,
    sessionRepository,
    refreshSessionRepository,
    now = () => new Date(),
) {
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

    async function issueCredentials(user, secure, withRefresh) {
        const issuedAt = now();
        const token = createSessionToken();
        const tokenHash = await hashSessionToken(token);
        const expiresAt = new Date(issuedAt.getTime() + SESSION_DURATION_SECONDS * 1000).toISOString();
        await sessionRepository.create({ tokenHash, userId: user.id, expiresAt });
        let rawRefreshToken = null;
        let rawRefreshCookie = null;
        if (withRefresh) {
            rawRefreshToken = createSessionToken();
            const refreshTokenHash = await hashSessionToken(rawRefreshToken);
            const refreshExpiresAt = new Date(
                issuedAt.getTime() + REFRESH_DURATION_SECONDS * 1000,
            ).toISOString();
            try {
                await refreshSessionRepository.create({
                    tokenHash: refreshTokenHash,
                    accessTokenHash: tokenHash,
                    userId: user.id,
                    expiresAt: refreshExpiresAt,
                });
            } catch (error) {
                await sessionRepository.delete(tokenHash);
                throw error;
            }
            rawRefreshCookie = refreshCookie(rawRefreshToken, secure);
        }
        const cookie = sessionCookie(token, secure);
        return {
            user,
            token,
            tokenHash,
            refreshToken: rawRefreshToken,
            cookie,
            refreshCookie: rawRefreshCookie,
            cookies: [cookie, rawRefreshCookie].filter(Boolean),
        };
    }

    return {
        async login(rawUsername, password, secure, withRefresh = true) {
            const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
            const user = username ? await userRepository.findByUsername(username) : null;
            if (!user || typeof password !== "string" || !await verifyPassword(password, user.passwordHash)) {
                throw new AppError(401, "Invalid username or password", "invalid_credentials");
            }
            if (user.disabled) {
                throw new AppError(403, "This account is disabled", "account_disabled");
            }
            return issueCredentials(user, secure, withRefresh);
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

        async refresh(request, secure) {
            const rawToken = parseCookies(request.headers.get("Cookie") || "")[REFRESH_COOKIE_NAME];
            if (!rawToken) {
                throw new AppError(401, "Refresh token is invalid or expired", "invalid_refresh_token");
            }
            const refreshTokenHash = await hashSessionToken(rawToken);
            const refreshSession = await refreshSessionRepository.consume(refreshTokenHash);
            if (!refreshSession) {
                throw new AppError(401, "Refresh token is invalid or expired", "invalid_refresh_token");
            }
            await sessionRepository.delete(refreshSession.accessTokenHash);
            const user = await userRepository.findById(refreshSession.userId);
            if (!user || user.disabled) {
                throw new AppError(401, "Refresh token is invalid or expired", "invalid_refresh_token");
            }
            return issueCredentials(user, secure, true);
        },

        async logout(request, secure) {
            const context = await tokenContext(request);
            if (context) {
                await refreshSessionRepository.deleteByAccessTokenHash(context.tokenHash);
                await sessionRepository.delete(context.tokenHash);
            }
            const rawRefreshToken = parseCookies(request.headers.get("Cookie") || "")[REFRESH_COOKIE_NAME];
            if (rawRefreshToken) {
                await refreshSessionRepository.delete(await hashSessionToken(rawRefreshToken));
            }
            return clearSessionCookies(secure);
        },
    };
}
