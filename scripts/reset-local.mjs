import { access, rm } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resetLocalState(projectRoot) {
    const root = resolve(projectRoot);
    if (root === parse(root).root) {
        throw new Error("Refusing to reset local state from a filesystem root");
    }
    const stateDirectory = resolve(root, ".wrangler", "state");
    try {
        await access(stateDirectory);
    } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
    }
    await rm(stateDirectory, { recursive: true, force: true });
    return true;
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryPoint === import.meta.url) {
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const removed = await resetLocalState(projectRoot);
    console.log(removed
        ? "Local D1, R2, and cache state was removed."
        : "Local D1, R2, and cache state is already empty.");
}
