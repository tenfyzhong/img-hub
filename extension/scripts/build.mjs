import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import { zipSync } from "fflate";

const extensionDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconSizes = [16, 32, 48, 128];
const iconPaths = Object.fromEntries(iconSizes.map((size) => [size, `icons/icon-${size}.png`]));
const supportedBrowsers = ["chrome", "edge", "firefox"];
const brandBackground = [49, 92, 73];
const brandForeground = [245, 241, 232];
const brandImagePolygon = [
    [7, 27.5],
    [15.5, 19],
    [20.7, 24.2],
    [25.2, 19.7],
    [33, 27.5],
    [33, 33],
    [7, 33],
];

function normalizeExtensionVersion(value) {
    const versionName = String(value || "").replace(/^v(?=\d)/, "");
    if (versionName === "0.0.0-dev") {
        return { manifestVersion: "0.0.0.1", versionName };
    }
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(versionName)) {
        throw new Error(`Extension version must be MAJOR.MINOR.PATCH with an optional fourth number: ${value}`);
    }
    for (const component of versionName.split(".")) {
        if (Number(component) > 65_535 || (component.length > 1 && component.startsWith("0"))) {
            throw new Error(`Extension version component is invalid for Chromium: ${component}`);
        }
    }
    if (versionName.split(".").every((component) => Number(component) === 0)) {
        throw new Error("Extension release version cannot contain only zero components");
    }
    return { manifestVersion: versionName, versionName };
}

export function createManifest({ browser, version }) {
    if (!supportedBrowsers.includes(browser)) {
        throw new Error(`Unsupported extension browser: ${browser}`);
    }
    const normalizedVersion = normalizeExtensionVersion(version);
    const manifest = {
        manifest_version: 3,
        name: "__MSG_extensionName__",
        description: "__MSG_extensionDescription__",
        default_locale: "en",
        version: normalizedVersion.manifestVersion,
        permissions: ["storage", "clipboardWrite"],
        optional_host_permissions: [
            "https://*/*",
            "http://localhost/*",
            "http://127.0.0.1/*",
            "http://[::1]/*",
        ],
        icons: iconPaths,
        action: {
            default_title: "__MSG_extensionName__",
            default_popup: "popup.html",
            default_icon: iconPaths,
        },
    };
    if (normalizedVersion.versionName !== normalizedVersion.manifestVersion) {
        manifest.version_name = normalizedVersion.versionName;
    }
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

function insideRoundedBrand(x, y, size) {
    const radii = [11, 11, 15, 9].map((radius) => radius * size / 34);
    const corners = [
        [radii[0], radii[0], x < radii[0] && y < radii[0]],
        [size - radii[1], radii[1], x > size - radii[1] && y < radii[1]],
        [size - radii[2], size - radii[2], x > size - radii[2] && y > size - radii[2]],
        [radii[3], size - radii[3], x < radii[3] && y > size - radii[3]],
    ];
    for (let index = 0; index < corners.length; index += 1) {
        const [centerX, centerY, applies] = corners[index];
        if (applies && (x - centerX) ** 2 + (y - centerY) ** 2 > radii[index] ** 2) {
            return false;
        }
    }
    return true;
}

function insidePolygon(x, y, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
        const [currentX, currentY] = polygon[current];
        const [previousX, previousY] = polygon[previous];
        if ((currentY > y) !== (previousY > y)
            && x < (previousX - currentX) * (y - currentY) / (previousY - currentY) + currentX) {
            inside = !inside;
        }
    }
    return inside;
}

function insideBrandImage(x, y, size) {
    const padding = size * 6 / 34;
    const contentSize = size - padding * 2;
    const viewX = (x - padding) * 40 / contentSize;
    const viewY = (y - padding) * 40 / contentSize;
    const insideSun = (viewX - 25.5) ** 2 + (viewY - 12.5) ** 2 <= 16;
    return insideSun || insidePolygon(viewX, viewY, brandImagePolygon);
}

function createIcon(size) {
    const rowLength = 1 + size * 4;
    const pixels = Buffer.alloc(rowLength * size);
    const samplesPerAxis = 4;
    const sampleCount = samplesPerAxis ** 2;
    for (let y = 0; y < size; y += 1) {
        pixels[y * rowLength] = 0;
        for (let x = 0; x < size; x += 1) {
            let backgroundSamples = 0;
            let foregroundSamples = 0;
            for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
                for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
                    const pointX = x + (sampleX + 0.5) / samplesPerAxis;
                    const pointY = y + (sampleY + 0.5) / samplesPerAxis;
                    if (!insideRoundedBrand(pointX, pointY, size)) continue;
                    backgroundSamples += 1;
                    if (insideBrandImage(pointX, pointY, size)) foregroundSamples += 1;
                }
            }
            const offset = y * rowLength + 1 + x * 4;
            if (!backgroundSamples) continue;
            const foregroundRatio = foregroundSamples / backgroundSamples;
            for (let channel = 0; channel < 3; channel += 1) {
                pixels[offset + channel] = Math.round(
                    brandBackground[channel] * (1 - foregroundRatio)
                    + brandForeground[channel] * foregroundRatio,
                );
            }
            pixels[offset + 3] = Math.round(255 * backgroundSamples / sampleCount);
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
    browsers = supportedBrowsers,
} = {}) {
    const extensionPackage = JSON.parse(
        await readFile(join(projectDirectory, "extension", "package.json"), "utf8"),
    );
    const extensionVersion = normalizeExtensionVersion(version || extensionPackage.version).versionName;
    const selectedBrowsers = [...new Set(browsers)];
    for (const browser of selectedBrowsers) {
        if (!supportedBrowsers.includes(browser)) {
            throw new Error(`Unsupported extension browser: ${browser}`);
        }
    }

    const sourceDirectory = join(projectDirectory, "extension", "src");
    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });
    const result = {};
    for (const browser of selectedBrowsers) {
        const browserDirectory = join(outputDirectory, browser);
        await cp(sourceDirectory, browserDirectory, { recursive: true });
        await cp(join(projectDirectory, "public", "md5.js"), join(browserDirectory, "md5.js"));
        await cp(join(projectDirectory, "public", "i18n.js"), join(browserDirectory, "i18n.js"));
        await cp(join(projectDirectory, "public", "ui-utils.js"), join(browserDirectory, "ui-utils.js"));
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
    const options = { browsers: [] };
    for (let index = 2; index < process.argv.length; index += 1) {
        const argument = process.argv[index];
        if (argument === "--browser" && process.argv[index + 1]) {
            options.browsers.push(process.argv[index + 1]);
            index += 1;
        } else if (argument === "--version" && process.argv[index + 1]) {
            options.version = process.argv[index + 1];
            index += 1;
        } else {
            throw new Error(`Unknown or incomplete extension build argument: ${argument}`);
        }
    }
    if (!options.browsers.length) delete options.browsers;
    const result = await buildExtensionPackages(options);
    for (const browser of options.browsers || supportedBrowsers) {
        console.log(`Built ${basename(result[`${browser}Zip`])}`);
    }
}
