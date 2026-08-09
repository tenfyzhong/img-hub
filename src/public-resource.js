function cacheStatus(response, value) {
    const headers = new Headers(response.headers);
    headers.set("X-ImgHub-Cache", value);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function cacheCandidate(request) {
    if (request.method !== "GET") return null;
    const url = new URL(request.url);
    const versions = url.searchParams.getAll("v");
    if (url.searchParams.size !== 1 || versions.length !== 1 || !/^\d+$/.test(versions[0])) {
        return null;
    }
    return {
        key: new Request(url.toString(), { method: "GET" }),
        version: Number(versions[0]),
    };
}

function contentHeaders(resource, cacheable, renderedText = null) {
    const headers = new Headers({
        "Content-Type": renderedText?.contentType || resource.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": cacheable
            ? "public, max-age=0, s-maxage=31536000, must-revalidate"
            : "public, max-age=0, must-revalidate",
    });
    if (resource.kind === "text") {
        headers.set("Content-Disposition", "inline");
        if (renderedText?.contentSecurityPolicy) {
            headers.set("Content-Security-Policy", renderedText.contentSecurityPolicy);
        }
    } else if (!resource.contentType.startsWith("image/") || resource.contentType === "image/svg+xml") {
        headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(resource.name)}`);
    }
    if (resource.contentType === "image/svg+xml") {
        headers.set("Content-Security-Policy", "sandbox");
    }
    return headers;
}

export async function servePublicResource({
    request,
    bucket,
    repository,
    route,
    cache = null,
    context = null,
}) {
    const candidate = cacheCandidate(request);
    const resource = await repository.findByPublicId(route.publicId);
    if (!resource) {
        return new Response("Not found", { status: 404 });
    }
    if (candidate && cache) {
        try {
            const cached = await cache.match(candidate.key);
            if (cached) return cacheStatus(cached, "HIT");
        } catch (error) {
            console.warn("ImgHub cache lookup failed", error);
        }
    }

    const object = request.method === "HEAD"
        ? await bucket.head(resource.objectKey)
        : await bucket.get(resource.objectKey);
    if (!object) {
        return new Response("Not found", { status: 404 });
    }

    const cacheable = Boolean(candidate && cache && candidate.version === resource.version);
    let renderedText = null;
    if (resource.kind === "text") {
        const raw = await new Response(object.body).text();
        renderedText = renderTextContent(resource.textFormat || "plain", raw);
    }
    const headers = contentHeaders(resource, cacheable, renderedText);
    if (object.httpEtag || object.etag) {
        headers.set("ETag", object.httpEtag || object.etag);
    }
    const body = resource.kind === "text" ? renderedText.body : object.body;
    const response = new Response(request.method === "HEAD" ? null : body, { headers });
    if (!cacheable) return cacheStatus(response, "BYPASS");

    const stored = cache.put(candidate.key, response.clone()).catch((error) => {
        console.warn("ImgHub cache write failed", error);
    });
    if (context?.waitUntil) {
        context.waitUntil(stored);
    } else {
        await stored;
    }
    return cacheStatus(response, "MISS");
}
import { renderTextContent } from "./text-format.js";
