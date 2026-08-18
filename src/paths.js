const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;

export function normalizeDirectory(value = "") {
    if (typeof value !== "string") {
        throw new Error("Invalid directory");
    }
    const parts = value.trim().split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === ".." || !/^[\p{L}\p{N}_. -]+$/u.test(part))) {
        throw new Error("Invalid directory");
    }
    const normalized = parts.map((part) => part.trim().replace(/\s+/g, "-")).join("/");
    if (normalized.length > 240) {
        throw new Error("Invalid directory: path is too long");
    }
    return normalized;
}

export function sanitizeFileName(value) {
    if (typeof value !== "string" || value.includes("/") || value.includes("\\")) {
        throw new Error("Invalid file name");
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === "." || trimmed === "..") {
        throw new Error("Invalid file name");
    }
    const sanitized = trimmed
        .normalize("NFKC")
        .replace(/\s+/g, "-")
        .replace(/[^\p{L}\p{N}._-]+/gu, "")
        .replace(/-{2,}/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
    if (!sanitized || sanitized.length > 180) {
        throw new Error("Invalid file name");
    }
    return sanitized;
}

export function buildObjectKey(userId, kind, directory, name) {
    if (!SAFE_IDENTIFIER.test(userId)) {
        throw new Error("Invalid user identifier");
    }
    if (kind !== "file" && kind !== "text") {
        throw new Error("Invalid resource kind");
    }
    const safeDirectory = normalizeDirectory(directory);
    const safeName = sanitizeFileName(name);
    return ["users", userId, kind, safeDirectory, safeName].filter(Boolean).join("/");
}

export function buildPublicUrl(origin, publicId, version) {
    if (!/^[0-9a-km-zA-NP-Z]{6,32}$/.test(publicId)) {
        throw new Error("Invalid public identifier");
    }
    return `${origin.replace(/\/$/, "")}/pub/${publicId}?v=${Number(version)}`;
}
