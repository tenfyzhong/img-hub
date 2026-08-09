import assert from "node:assert/strict";
import test from "node:test";

import {
    contentTypeForText,
    normalizeTextFormat,
    renderTextContent,
    sanitizeRichText,
} from "../src/text-format.js";

test("text formats are validated and mapped to stored content types", () => {
    assert.equal(normalizeTextFormat("markdown"), "markdown");
    assert.equal(normalizeTextFormat("rich"), "rich");
    assert.equal(normalizeTextFormat(), "plain");
    assert.equal(contentTypeForText("markdown"), "text/markdown; charset=utf-8");
    assert.equal(contentTypeForText("rich"), "text/html; charset=utf-8");
    assert.throws(() => normalizeTextFormat("javascript"), /format/i);
});

test("markdown is rendered as safe HTML", () => {
    const rendered = renderTextContent("markdown", "# Hello\n\n**bold** and [site](https://example.com)\n\n<script>alert(1)</script>");

    assert.equal(rendered.contentType, "text/html; charset=utf-8");
    assert.match(rendered.body, /<h1>Hello<\/h1>/);
    assert.match(rendered.body, /<strong>bold<\/strong>/);
    assert.match(rendered.body, /href="https:\/\/example\.com"/);
    assert.doesNotMatch(rendered.body, /<script/i);
    assert.match(rendered.contentSecurityPolicy, /default-src 'none'/);
    assert.match(rendered.contentSecurityPolicy, /frame-ancestors 'self'/);
});

test("rich text preserves a small formatting allowlist without executable markup", () => {
    const sanitized = sanitizeRichText(
        '<p><b>Hello</b><img src=x onerror=alert(1)><script>alert(1)</script></p>',
    );
    const rendered = renderTextContent(
        "rich",
        '<p><b>Hello</b><img src=x onerror=alert(1)><script>alert(1)</script></p>',
    );

    assert.match(sanitized, /<p><b>Hello<\/b>/);
    assert.doesNotMatch(sanitized, /<img|<script|onerror/i);
    assert.match(rendered.body, /<p><b>Hello<\/b>/);
    assert.doesNotMatch(rendered.body, /<img|<script|onerror/i);
    assert.match(rendered.body, /&lt;img/);
});

test("plain text remains plain text", () => {
    const rendered = renderTextContent("plain", "<b>literal</b>");
    assert.equal(rendered.contentType, "text/plain; charset=utf-8");
    assert.equal(rendered.body, "<b>literal</b>");
});
