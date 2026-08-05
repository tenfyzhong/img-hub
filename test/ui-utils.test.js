import assert from "node:assert/strict";
import test from "node:test";

import {
    buildShareFormats,
    filesFromClipboard,
    generateRandomPassword,
} from "../public/ui-utils.js";

test("generated temporary passwords are long and contain several character classes", () => {
    const password = generateRandomPassword();
    assert.ok(password.length >= 18);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
});

test("share formats provide raw URL, Markdown, and safe HTML", () => {
    const formats = buildShareFormats({
        kind: "file",
        name: 'lake".png',
        contentType: "image/png",
        url: "https://img.example.com/file/pub_abc?v=2&download=1",
    });

    assert.equal(formats.url, "https://img.example.com/file/pub_abc?v=2&download=1");
    assert.match(formats.markdown, /^!\[/);
    assert.match(formats.html, /^<img /);
    assert.match(formats.html, /&quot;/);
    assert.match(formats.html, /&amp;/);
});

test("extracts pasted files and gives unnamed clipboard images safe names", () => {
    const documentFile = new File(["report"], "report.pdf", { type: "application/pdf" });
    const screenshot = new File([new Uint8Array([1, 2, 3])], "", { type: "image/png" });
    const files = filesFromClipboard({
        files: [],
        items: [
            { kind: "string", getAsFile: () => null },
            { kind: "file", getAsFile: () => documentFile },
            { kind: "file", getAsFile: () => screenshot },
        ],
    }, Date.UTC(2026, 7, 6, 4, 5, 6));

    assert.equal(files.length, 2);
    assert.equal(files[0], documentFile);
    assert.equal(files[1].name, "clipboard-20260806T040506-2.png");
    assert.equal(files[1].type, "image/png");
    assert.equal(files[1].size, 3);
});

test("prefers clipboard file lists without duplicating data-transfer items", () => {
    const file = new File(["archive"], "archive.zip", { type: "application/zip" });
    const files = filesFromClipboard({
        files: [file],
        items: [{ kind: "file", getAsFile: () => file }],
    });

    assert.deepEqual(files, [file]);
    assert.deepEqual(filesFromClipboard(null), []);
});
