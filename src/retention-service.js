import { AppError, requireAdministrator } from "./errors.js";

const DEFAULT_RETENTION_DAYS = 91;
const MAX_RETENTION_DAYS = 3650;
const PAGE_SIZE = 1000;
const MAX_OBJECTS_PER_RUN = 10000;
const RETENTION_KEY = "r2_retention_days";

function normalizeDays(value) {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
        throw new AppError(
            400,
            "Retention days must be an integer between 1 and 3650",
            "invalid_retention_days",
        );
    }
    return days;
}

export function createRetentionService(repository, bucket, now = () => new Date()) {
    async function retentionDays() {
        const stored = await repository.get(RETENTION_KEY);
        if (stored === null) return DEFAULT_RETENTION_DAYS;
        try {
            return normalizeDays(stored);
        } catch {
            return DEFAULT_RETENTION_DAYS;
        }
    }

    return {
        async get(user) {
            requireAdministrator(user);
            return { retentionDays: await retentionDays() };
        },

        async update(user, value) {
            requireAdministrator(user);
            const days = normalizeDays(value);
            await repository.set(RETENTION_KEY, days);
            return { retentionDays: days };
        },

        async run() {
            const days = await retentionDays();
            const cutoff = now().getTime() - (days * 24 * 60 * 60 * 1000);
            let cursor;
            let scanned = 0;
            let deleted = 0;

            while (scanned < MAX_OBJECTS_PER_RUN) {
                const options = { prefix: "users/", limit: PAGE_SIZE };
                if (cursor) options.cursor = cursor;
                const page = await bucket.list(options);
                const objects = page.objects || [];
                scanned += objects.length;
                const expired = objects
                    .filter((object) => new Date(object.uploaded).getTime() <= cutoff)
                    .map((object) => object.key);
                if (expired.length > 0) {
                    await bucket.delete(expired);
                    deleted += expired.length;
                }
                if (!page.truncated || !page.cursor || objects.length === 0) break;
                cursor = page.cursor;
            }

            return { scanned, deleted, retentionDays: days };
        },
    };
}
