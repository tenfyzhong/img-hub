export async function tryWriteClipboard(clipboard, value) {
    if (typeof clipboard?.writeText !== "function") return false;
    try {
        await clipboard.writeText(String(value));
        return true;
    } catch {
        return false;
    }
}
