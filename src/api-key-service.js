import { createSessionToken, hashSessionToken } from "./auth.js";
import { AppError, requireActiveUser, requireOwner } from "./errors.js";

const MAX_ACTIVE_KEYS = 20;

function publicApiKey(apiKey) {
    return {
        id: apiKey.id,
        userId: apiKey.userId,
        name: apiKey.name,
        prefix: apiKey.prefix,
        expiresAt: apiKey.expiresAt || null,
        lastUsedAt: apiKey.lastUsedAt || null,
        revokedAt: apiKey.revokedAt || null,
        createdAt: apiKey.createdAt,
    };
}

function validateName(value) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 64) {
        throw new AppError(400, "API key name must be between 1 and 64 characters", "invalid_api_key_name");
    }
    return name;
}

function calculateExpiry(value, now) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new AppError(400, "API key expiry must be between 1 and 365 days", "invalid_api_key_expiry");
    }
    return new Date(now.getTime() + days * 86400000).toISOString();
}

export function createApiKeyService(repository, now = () => new Date()) {
    return {
        async create(user, rawName, expiresInDays) {
            requireActiveUser(user);
            if (await repository.countActiveByOwner(user.id) >= MAX_ACTIVE_KEYS) {
                throw new AppError(409, "A user may have at most 20 active API keys", "api_key_limit");
            }
            const name = validateName(rawName);
            const token = `imh_${createSessionToken()}`;
            const record = {
                id: `key_${crypto.randomUUID().replaceAll("-", "")}`,
                userId: user.id,
                name,
                prefix: token.slice(0, 12),
                tokenHash: await hashSessionToken(token),
                expiresAt: calculateExpiry(expiresInDays, now()),
                lastUsedAt: null,
                revokedAt: null,
            };
            await repository.create(record);
            return { token, apiKey: publicApiKey(record) };
        },

        async list(user) {
            requireActiveUser(user);
            return (await repository.listByOwner(user.id)).map(publicApiKey);
        },

        async revoke(user, apiKeyId) {
            requireActiveUser(user);
            const apiKey = await repository.findById(apiKeyId);
            requireOwner(user, apiKey && { createdBy: apiKey.userId });
            await repository.revoke(apiKeyId);
        },

        async authenticate(token) {
            if (typeof token !== "string" || !/^imh_[A-Za-z0-9_-]{40,}$/.test(token)) {
                return null;
            }
            return repository.findUserByTokenHash(await hashSessionToken(token));
        },
    };
}
