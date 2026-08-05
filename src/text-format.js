import { AppError } from "./errors.js";

const FORMATS = new Set(["plain", "markdown", "rich"]);
const RICH_TAGS = /&lt;(\/?)(p|div|br|b|strong|i|em|u|s|ul|ol|li|blockquote|h1|h2|h3|pre|code)&gt;/gi;
const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function renderInlineMarkdown(value) {
    let rendered = escapeHtml(value);
    rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
    rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    rendered = rendered.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    rendered = rendered.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, (match, label, url) => {
        try {
            const parsed = new URL(url.replaceAll("&amp;", "&"));
            if (!["http:", "https:"].includes(parsed.protocol)) return match;
            return `<a href="${escapeHtml(url.replaceAll("&amp;", "&"))}" rel="noreferrer noopener">${label}</a>`;
        } catch {
            return match;
        }
    });
    return rendered;
}

function markdownToHtml(markdown) {
    const output = [];
    let list = null;
    let code = false;
    const closeList = () => {
        if (list) output.push(`</${list}>`);
        list = null;
    };
    for (const line of String(markdown).replaceAll("\r\n", "\n").split("\n")) {
        if (line.trim().startsWith("```")) {
            closeList();
            output.push(code ? "</code></pre>" : "<pre><code>");
            code = !code;
            continue;
        }
        if (code) {
            output.push(`${escapeHtml(line)}\n`);
            continue;
        }
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
            closeList();
            const level = heading[1].length;
            output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }
        const unordered = line.match(/^\s*[-*]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (unordered || ordered) {
            const nextList = unordered ? "ul" : "ol";
            if (list !== nextList) {
                closeList();
                list = nextList;
                output.push(`<${list}>`);
            }
            output.push(`<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`);
            continue;
        }
        closeList();
        if (!line.trim()) continue;
        if (line.startsWith("> ")) {
            output.push(`<blockquote>${renderInlineMarkdown(line.slice(2))}</blockquote>`);
        } else {
            output.push(`<p>${renderInlineMarkdown(line)}</p>`);
        }
    }
    closeList();
    if (code) output.push("</code></pre>");
    return output.join("\n");
}

export function sanitizeRichText(value) {
    const stripped = String(value)
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<([a-z][a-z0-9]*)\b[^>]*>/gi, "<$1>");
    return escapeHtml(stripped).replace(RICH_TAGS, (match, closing, tag) => {
        const normalized = tag.toLowerCase();
        if (normalized === "br" && closing) return "";
        return `<${closing ? "/" : ""}${normalized}>`;
    });
}

function htmlDocument(content, format) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{max-width:76ch;margin:0 auto;padding:32px 22px;color:#18221e;background:#f8f5ed;font:16px/1.7 system-ui,sans-serif}article{overflow-wrap:anywhere}pre,code{font-family:ui-monospace,monospace}pre{overflow:auto;padding:16px;border-radius:10px;background:#ebe7dc}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #315c49;color:#66736c}a{color:#214235}</style></head><body><article data-format="${format}">${content}</article></body></html>`;
}

export function normalizeTextFormat(value = "plain") {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!FORMATS.has(normalized || "plain")) {
        throw new AppError(400, "Text format must be plain, markdown, or rich", "invalid_text_format");
    }
    return normalized || "plain";
}

export function contentTypeForText(format) {
    const normalized = normalizeTextFormat(format);
    if (normalized === "markdown") return "text/markdown; charset=utf-8";
    if (normalized === "rich") return "text/html; charset=utf-8";
    return "text/plain; charset=utf-8";
}

export function renderTextContent(format, content) {
    const normalized = normalizeTextFormat(format);
    if (normalized === "plain") {
        return { body: String(content), contentType: "text/plain; charset=utf-8", contentSecurityPolicy: null };
    }
    const rendered = normalized === "markdown" ? markdownToHtml(content) : sanitizeRichText(content);
    return {
        body: htmlDocument(rendered, normalized),
        contentType: "text/html; charset=utf-8",
        contentSecurityPolicy: HTML_CSP,
    };
}
