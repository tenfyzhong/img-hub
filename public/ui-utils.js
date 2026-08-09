function randomIndex(maximum) {
    const values = crypto.getRandomValues(new Uint32Array(1));
    return values[0] % maximum;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

const clipboardImageExtensions = new Map([
    ["image/avif", ".avif"],
    ["image/bmp", ".bmp"],
    ["image/gif", ".gif"],
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/svg+xml", ".svg"],
    ["image/tiff", ".tiff"],
    ["image/webp", ".webp"],
]);

function clipboardTimestamp(now) {
    return new Date(now).toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "");
}

function nameClipboardFile(file, index, now) {
    if (file.name) return file;
    const extension = clipboardImageExtensions.get(file.type) || ".bin";
    return new File([file], `clipboard-${clipboardTimestamp(now)}-${index + 1}${extension}`, {
        type: file.type || "application/octet-stream",
        lastModified: now,
    });
}

export function filesFromClipboard(clipboardData, now = Date.now()) {
    if (!clipboardData) return [];
    const directFiles = [...(clipboardData.files || [])];
    const files = directFiles.length > 0
        ? directFiles
        : [...(clipboardData.items || [])]
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter(Boolean);
    return files.map((file, index) => nameClipboardFile(file, index, now));
}

export function generateRandomPassword(length = 20) {
    const groups = [
        "ABCDEFGHJKLMNPQRSTUVWXYZ",
        "abcdefghijkmnopqrstuvwxyz",
        "23456789",
        "!@#$%^&*-_=+",
    ];
    const all = groups.join("");
    const characters = groups.map((group) => group[randomIndex(group.length)]);
    while (characters.length < Math.max(18, length)) {
        characters.push(all[randomIndex(all.length)]);
    }
    for (let index = characters.length - 1; index > 0; index -= 1) {
        const target = randomIndex(index + 1);
        [characters[index], characters[target]] = [characters[target], characters[index]];
    }
    return characters.join("");
}

export function buildShareFormats(resource) {
    const url = String(resource.url);
    const markdownName = String(resource.name).replaceAll("\\", "\\\\").replaceAll("]", "\\]");
    const image = String(resource.contentType || "").startsWith("image/") && resource.contentType !== "image/svg+xml";
    return {
        url,
        markdown: image ? `![${markdownName}](${url})` : `[${markdownName}](${url})`,
        html: image
            ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(resource.name)}">`
            : `<a href="${escapeHtml(url)}">${escapeHtml(resource.name)}</a>`,
    };
}
