import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import { zipSync } from "fflate";

const extensionDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconSizes = [16, 32, 48, 128];
const iconPaths = Object.fromEntries(iconSizes.map((size) => [size, `icons/icon-${size}.png`]));

export function createManifest({ browser, version }) {
    const manifest = {
        manifest_version: 3,
        name: "ImgHub Companion",
        description: "Upload and manage images in any ImgHub deployment.",
        version,
        permissions: ["storage", "clipboardWrite"],
        optional_host_permissions: [
            "https://*/*",
            "http://localhost/*",
            "http://127.0.0.1/*",
        ],
        icons: iconPaths,
        action: {
            default_title: "ImgHub Companion",
            default_popup: "popup.html",
            default_icon: iconPaths,
        },
    };
    if (browser === "firefox") {
        manifest.browser_specific_settings = {
            gecko: {
                id: "img-hub@tenfyzhong.com",
                strict_min_version: "142.0",
                data_collection_permissions: {
                    required: ["none"],
                },
            },
        };
    }
    return manifest;
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
}

function createIcon(size) {
    const rowLength = 1 + size * 4;
    const pixels = Buffer.alloc(rowLength * size);
    const radius = size * 0.23;
    for (let y = 0; y < size; y += 1) {
        pixels[y * rowLength] = 0;
        for (let x = 0; x < size; x += 1) {
            const cornerX = Math.max(radius - x, 0, x - (size - 1 - radius));
            const cornerY = Math.max(radius - y, 0, y - (size - 1 - radius));
            const inside = cornerX * cornerX + cornerY * cornerY <= radius * radius;
            const normalizedX = (x + 0.5) / size;
            const normalizedY = (y + 0.5) / size;
            const letter = (
                ((normalizedX >= 0.27 && normalizedX <= 0.39)
                    || (normalizedX >= 0.61 && normalizedX <= 0.73))
                && normalizedY >= 0.24 && normalizedY <= 0.76
            ) || (
                normalizedX >= 0.36 && normalizedX <= 0.64
                && normalizedY >= 0.44 && normalizedY <= 0.56
            );
            const offset = y * rowLength + 1 + x * 4;
            const color = letter ? [247, 182, 79] : [27, 101, 86];
            pixels.set(color, offset);
            pixels[offset + 3] = inside ? 255 : 0;
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
        pngChunk("IEND"),
    ]);
}

async function writeIcons(browserDirectory) {
    const directory = join(browserDirectory, "icons");
    await mkdir(directory, { recursive: true });
    await Promise.all(iconSizes.map((size) => writeFile(join(directory, `icon-${size}.png`), createIcon(size))));
}

async function filesIn(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const path = join(directory, entry.name);
        files.push(...(entry.isDirectory() ? await filesIn(path) : [path]));
    }
    return files;
}

async function createZip(sourceDirectory, destination) {
    const entries = {};
    for (const path of await filesIn(sourceDirectory)) {
        entries[relative(sourceDirectory, path).replaceAll("\\", "/")] = new Uint8Array(await readFile(path));
    }
    await writeFile(destination, zipSync(entries, { level: 9 }));
}

export async function buildExtensionPackages({
    projectDirectory = resolve(extensionDirectory, ".."),
    outputDirectory = join(projectDirectory, "dist", "extensions"),
    version,
} = {}) {
    const packageJson = JSON.parse(await readFile(join(projectDirectory, "package.json"), "utf8"));
    const extensionVersion = version || packageJson.version;
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(extensionVersion)) {
        throw new Error(`Extension version must contain only numbers and dots: ${extensionVersion}`);
    }

    const sourceDirectory = join(projectDirectory, "extension", "src");
    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });
    const result = {};
    for (const browser of ["chromium", "firefox"]) {
        const browserDirectory = join(outputDirectory, browser);
        await cp(sourceDirectory, browserDirectory, { recursive: true });
        await cp(join(projectDirectory, "public", "md5.js"), join(browserDirectory, "md5.js"));
        await writeIcons(browserDirectory);
        await writeFile(
            join(browserDirectory, "manifest.json"),
            `${JSON.stringify(createManifest({ browser, version: extensionVersion }), null, 2)}\n`,
        );
        const zipPath = join(outputDirectory, `img-hub-extension-${browser}-v${extensionVersion}.zip`);
        await createZip(browserDirectory, zipPath);
        result[`${browser}Directory`] = browserDirectory;
        result[`${browser}Zip`] = zipPath;
    }
    return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const result = await buildExtensionPackages();
    console.log(`Built ${basename(result.chromiumZip)}`);
    console.log(`Built ${basename(result.firefoxZip)}`);
}
