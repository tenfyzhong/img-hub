import { sanitizeFileName } from "./paths.js";

const MAX_FILE_NAME_LENGTH = 180;

function compactTimestamp(now) {
    const value = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(value.getTime())) throw new Error("Invalid resource timestamp");
    return value.toISOString()
        .replace(/[-:]/g, "")
        .replace(".", "")
        .replace("Z", "");
}

function defaultTextName(textFormat) {
    return textFormat === "rich" ? "text.html" : "text.md";
}

export function timestampResourceName(rawName, { kind, textFormat = "plain", now = new Date() }) {
    const fallback = kind === "text" ? defaultTextName(textFormat) : "file";
    const safeName = sanitizeFileName(typeof rawName === "string" && rawName.trim() ? rawName : fallback);
    const extensionIndex = safeName.lastIndexOf(".");
    const hasExtension = extensionIndex > 0;
    const extension = hasExtension ? safeName.slice(extensionIndex) : "";
    const base = hasExtension ? safeName.slice(0, extensionIndex) : safeName;
    const suffix = `-${compactTimestamp(now)}`;
    const maximumBaseLength = MAX_FILE_NAME_LENGTH - suffix.length - extension.length;
    const shortenedBase = base.slice(0, Math.max(1, maximumBaseLength)).replace(/[-.]+$/g, "") || "file";
    return sanitizeFileName(`${shortenedBase}${suffix}${extension}`);
}
