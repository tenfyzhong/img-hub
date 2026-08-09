import {
    cpSync,
    existsSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.txt$/;

export function resolveWechatVerification(environment = {}) {
    const filename = environment.IMG_HUB_WECHAT_VERIFY_FILENAME || "";
    const content = environment.IMG_HUB_WECHAT_VERIFY_CONTENT || "";

    if (!filename && !content) {
        return null;
    }
    if (!filename || !content) {
        throw new Error(
            "IMG_HUB_WECHAT_VERIFY_FILENAME and IMG_HUB_WECHAT_VERIFY_CONTENT must both be configured",
        );
    }
    if (!SAFE_FILENAME.test(filename)) {
        throw new Error(
            "IMG_HUB_WECHAT_VERIFY_FILENAME must be a safe root-level .txt filename",
        );
    }
    return { filename, content };
}

export function prepareDeploymentAssets({
    sourceDirectory = "./public",
    temporaryRoot = tmpdir(),
    environment = process.env,
} = {}) {
    const verification = resolveWechatVerification(environment);
    if (!verification) {
        return {
            directory: sourceDirectory,
            cleanup() {},
        };
    }

    const sourceVerificationPath = join(sourceDirectory, verification.filename);
    if (existsSync(sourceVerificationPath)) {
        throw new Error(
            `WeChat verification file would overwrite an existing public asset: ${verification.filename}`,
        );
    }

    const directory = mkdtempSync(join(temporaryRoot, "img-hub-assets-"));
    try {
        cpSync(sourceDirectory, directory, { recursive: true });
        writeFileSync(join(directory, verification.filename), verification.content, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
        });
    } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
    }

    return {
        directory,
        cleanup() {
            rmSync(directory, { recursive: true, force: true });
        },
    };
}
