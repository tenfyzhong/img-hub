import { AppError } from "./errors.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 100;

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizePageOptions(input = {}) {
    const page = positiveInteger(input.page, 1);
    const pageSize = Math.min(positiveInteger(input.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (query.length > MAX_QUERY_LENGTH) {
        throw new AppError(400, "Search query must not exceed 100 characters", "invalid_search_query");
    }
    return {
        page,
        pageSize,
        query,
        offset: (page - 1) * pageSize,
    };
}

export function escapeLikePattern(value) {
    return `%${String(value).replace(/[\\%_]/g, "\\$&")}%`;
}

export function paginated(items, total, options) {
    const normalizedTotal = Math.max(0, Number(total) || 0);
    return {
        items,
        pagination: {
            page: options.page,
            pageSize: options.pageSize,
            total: normalizedTotal,
            totalPages: Math.max(1, Math.ceil(normalizedTotal / options.pageSize)),
        },
    };
}
