import { createAuthService } from "./auth-service.js";
import { createApiKeyService } from "./api-key-service.js";
import { assertPasswordConfirmation, hashPassword } from "./auth.js";
import { createRepositories } from "./database.js";
import { AppError, requireActiveUser } from "./errors.js";
import { assertSameOrigin, json, progressStream, readJson, routePublicResource } from "./http.js";
import { createLoginProtection } from "./login-protection.js";
import { publicNotFound } from "./not-found-page.js";
import { buildPublicUrl } from "./paths.js";
import { servePublicResource } from "./public-resource.js";
import { fetchRemoteFile } from "./remote-file.js";
import { createResourceService } from "./resource-service.js";
import { createRetentionService } from "./retention-service.js";
import { ensureSchema } from "./schema.js";
import { createSiteSettingsService } from "./site-settings-service.js";
import { ADMIN_USERNAME, createUserService } from "./user-service.js";
import { contentTypeForText, normalizeTextFormat } from "./text-format.js";

function newId(prefix) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        disabled: user.disabled,
        createdAt: user.createdAt,
    };
}

function isSecure(request) {
    return new URL(request.url).protocol === "https:";
}

function resourceWithUrl(resource, origin) {
    return {
        ...resource,
        url: buildPublicUrl(origin, resource.publicId, resource.version),
    };
}

function pageOptions(url) {
    return {
        page: url.searchParams.get("page"),
        pageSize: url.searchParams.get("pageSize"),
        query: url.searchParams.get("q") || "",
    };
}

async function readFileUpload(request) {
    const type = request.headers.get("Content-Type") || "";
    if (!type.toLowerCase().includes("multipart/form-data")) {
        throw new AppError(415, "Content-Type must be multipart/form-data", "invalid_content_type");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function" || !file.name) {
        throw new AppError(400, "A file is required", "file_required");
    }
    return {
        file,
        directory: String(form.get("directory") || ""),
        content: await file.arrayBuffer(),
        contentType: file.type || "application/octet-stream",
        contentMd5: String(form.get("md5") || ""),
        size: file.size,
    };
}

function readBearerToken(request) {
    return (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requirePrincipal(auth, apiKeyService, request) {
    const session = await auth.authenticate(request);
    if (session) {
        return session;
    }
    const token = readBearerToken(request);
    const user = await apiKeyService.authenticate(token);
    if (user) {
        return { user, tokenHash: null, authType: "api_key" };
    }
    throw new AppError(401, "Authentication is required", "authentication_required");
}

async function handleApi(request, env, repositories) {
    assertSameOrigin(request);
    const url = new URL(request.url);
    const path = url.pathname;
    const secure = isSecure(request);
    const auth = createAuthService(
        repositories.users,
        repositories.sessions,
        repositories.refreshSessions,
    );
    const loginProtection = createLoginProtection(repositories.loginChallenges, {
        siteKey: env.TURNSTILE_SITE_KEY,
        secretKey: env.TURNSTILE_SECRET_KEY,
    });
    const apiKeyService = createApiKeyService(repositories.apiKeys);
    const siteSettingsService = createSiteSettingsService(repositories.settings);
    const retentionService = createRetentionService(repositories.settings, env.BUCKET);
    const userService = createUserService(repositories.users);
    const resourceService = createResourceService(repositories.resources, env.BUCKET);

    if (request.method === "GET" && path === "/api/health") {
        return json({ ok: true });
    }
    if (request.method === "GET" && path === "/api/setup/status") {
        return json({
            initialized: await repositories.users.count() > 0,
            turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
        });
    }
    if (request.method === "GET" && path === "/api/site-settings") {
        return json({ site: await siteSettingsService.get() });
    }
    if (request.method === "POST" && path === "/api/setup") {
        if (await repositories.users.count() > 0) {
            throw new AppError(409, "Application is already initialized", "already_initialized");
        }
        const body = await readJson(request);
        assertPasswordConfirmation(body.password, body.confirmPassword);
        const admin = {
            id: newId("usr"),
            username: ADMIN_USERNAME,
            passwordHash: await hashPassword(body.password),
            role: "admin",
            mustChangePassword: false,
            disabled: false,
        };
        try {
            await repositories.users.create(admin);
        } catch (error) {
            if (/unique|constraint/i.test(String(error?.message))) {
                throw new AppError(409, "Application is already initialized", "already_initialized");
            }
            throw error;
        }
        const login = await auth.login(ADMIN_USERNAME, body.password, secure);
        return json({ user: publicUser(login.user) }, 201, { "Set-Cookie": login.cookies });
    }
    if (request.method === "POST" && path === "/api/auth/login") {
        const body = await readJson(request);
        const attempt = await loginProtection.inspect(
            request,
            body.username,
            body.turnstileToken,
        );
        let login;
        try {
            login = await auth.login(body.username, body.password, secure, body.client !== "extension");
        } catch (error) {
            if (error instanceof AppError && error.code === "invalid_credentials") {
                const result = await loginProtection.recordFailure(attempt);
                if (result.turnstileRequired) {
                    throw new AppError(403, "Complete the login verification", "turnstile_required");
                }
            }
            throw error;
        }
        await loginProtection.clear(attempt);
        if (body.client === "extension") {
            return json({ user: publicUser(login.user), accessToken: login.token });
        }
        return json({ user: publicUser(login.user) }, 200, { "Set-Cookie": login.cookies });
    }
    if (request.method === "POST" && path === "/api/auth/refresh") {
        const refreshed = await auth.refresh(request, secure);
        return json({ user: publicUser(refreshed.user) }, 200, { "Set-Cookie": refreshed.cookies });
    }
    if (request.method === "POST" && path === "/api/auth/logout") {
        const cookies = await auth.logout(request, secure);
        return json({ ok: true }, 200, { "Set-Cookie": cookies });
    }

    const session = await requirePrincipal(auth, apiKeyService, request);
    if (request.method === "GET" && path === "/api/auth/me") {
        return json({ user: publicUser(session.user), authType: session.authType });
    }
    if (request.method === "POST" && path === "/api/auth/password") {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        const body = await readJson(request);
        assertPasswordConfirmation(body.newPassword, body.confirmPassword);
        await userService.changePassword(
            session.user,
            body.currentPassword,
            body.newPassword,
            session.tokenHash,
        );
        return json({ user: publicUser(session.user) });
    }

    requireActiveUser(session.user);
    if (request.method === "GET" && path === "/api/api-keys") {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        return json({ apiKeys: await apiKeyService.list(session.user) });
    }
    if (request.method === "POST" && path === "/api/api-keys") {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        const body = await readJson(request);
        return json(await apiKeyService.create(session.user, body.name, body.expiresInDays), 201);
    }
    const apiKeyMatch = path.match(/^\/api\/api-keys\/([^/]+)$/);
    if (request.method === "DELETE" && apiKeyMatch) {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        await apiKeyService.revoke(session.user, apiKeyMatch[1]);
        return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && path === "/api/resources") {
        const resources = await resourceService.list(session.user, url.searchParams.get("kind"));
        return json({
            resources: resources.map((resource) => resourceWithUrl(resource, url.origin)),
        });
    }
    if (request.method === "GET" && path === "/api/history") {
        return json({ events: await resourceService.listHistory(session.user, url.origin) });
    }
    if (request.method === "POST" && path === "/api/files") {
        const upload = await readFileUpload(request);
        const resource = await resourceService.create(session.user, {
            kind: "file",
            directory: upload.directory,
            name: upload.file.name,
            contentType: upload.contentType,
            contentMd5: upload.contentMd5,
            content: upload.content,
            size: upload.size,
            origin: url.origin,
        });
        return json({ resource }, 201);
    }
    if (request.method === "POST" && path === "/api/files/instant") {
        const body = await readJson(request);
        const resource = await resourceService.instantCopy(session.user, {
            directory: body.directory,
            name: body.name,
            contentMd5: body.md5,
            size: body.size,
            origin: url.origin,
        });
        return json({ instant: Boolean(resource), resource });
    }
    if (request.method === "POST" && path === "/api/files/import") {
        const body = await readJson(request);
        const importFile = async (send) => {
            const imported = await fetchRemoteFile(body.url, {
                onProgress(progress) {
                    send?.({ type: "progress", phase: "fetching", ...progress });
                },
            });
            send?.({
                type: "progress",
                phase: "saving",
                loaded: imported.size,
                total: imported.size,
                percent: 100,
            });
            return resourceService.create(session.user, {
                kind: "file",
                directory: body.directory,
                name: imported.name,
                contentType: imported.contentType,
                content: imported.content,
                size: imported.size,
                origin: url.origin,
                eventAction: "import",
                sourceUrl: imported.sourceUrl,
            });
        };
        if ((request.headers.get("Accept") || "").toLowerCase().includes("application/x-ndjson")) {
            return progressStream(async (send) => {
                send({ type: "progress", phase: "connecting", loaded: 0, total: null, percent: null });
                const resource = await importFile(send);
                send({ type: "complete", resource });
            });
        }
        const resource = await importFile();
        return json({ resource }, 201);
    }
    if (request.method === "POST" && path === "/api/texts") {
        const body = await readJson(request);
        const content = typeof body.content === "string" ? body.content : "";
        const textFormat = normalizeTextFormat(body.format);
        const encoded = new TextEncoder().encode(content);
        const resource = await resourceService.create(session.user, {
            kind: "text",
            directory: body.directory,
            name: body.name,
            contentType: contentTypeForText(textFormat),
            textFormat,
            content: encoded,
            size: encoded.byteLength,
            origin: url.origin,
        });
        return json({ resource }, 201);
    }

    const contentMatch = path.match(/^\/api\/resources\/([^/]+)\/content$/);
    if (request.method === "GET" && contentMatch) {
        const result = await resourceService.getContent(session.user, contentMatch[1]);
        return json({
            resource: resourceWithUrl(result.resource, url.origin),
            content: result.content,
        });
    }
    if (request.method === "PUT" && contentMatch) {
        let replacement;
        if ((request.headers.get("Content-Type") || "").toLowerCase().includes("multipart/form-data")) {
            const upload = await readFileUpload(request);
            replacement = {
                kind: "file",
                content: upload.content,
                contentType: upload.contentType,
                contentMd5: upload.contentMd5,
                size: upload.size,
                origin: url.origin,
            };
        } else {
            const body = await readJson(request);
            const content = typeof body.content === "string" ? body.content : "";
            const textFormat = normalizeTextFormat(body.format);
            const encoded = new TextEncoder().encode(content);
            replacement = {
                kind: "text",
                content: encoded,
                contentType: contentTypeForText(textFormat),
                textFormat,
                size: encoded.byteLength,
                origin: url.origin,
            };
        }
        const resource = await resourceService.replace(session.user, contentMatch[1], replacement);
        return json({ resource });
    }
    const resourceMatch = path.match(/^\/api\/resources\/([^/]+)$/);
    if (request.method === "DELETE" && resourceMatch) {
        await resourceService.delete(session.user, resourceMatch[1]);
        return new Response(null, { status: 204 });
    }

    if (request.method === "GET" && path === "/api/admin/resources") {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        const result = await resourceService.listForAuditPage(
            session.user,
            url.origin,
            pageOptions(url),
        );
        return json({ resources: result.items, pagination: result.pagination });
    }
    const blockResourceMatch = path.match(/^\/api\/admin\/resources\/([^/]+)\/block$/);
    if (request.method === "POST" && blockResourceMatch) {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        const resource = await resourceService.block(session.user, blockResourceMatch[1]);
        return json({ resource });
    }
    if (request.method === "GET" && path === "/api/admin/users") {
        const result = await userService.listUsersPage(session.user, pageOptions(url));
        return json({
            users: result.items.map(publicUser),
            pagination: result.pagination,
        });
    }
    if (request.method === "POST" && path === "/api/admin/users") {
        const body = await readJson(request);
        assertPasswordConfirmation(body.password, body.confirmPassword);
        const user = await userService.createUser(session.user, body.username, body.password);
        return json({ user: publicUser(user) }, 201);
    }
    const resetMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (request.method === "POST" && resetMatch) {
        const body = await readJson(request);
        assertPasswordConfirmation(body.password, body.confirmPassword);
        await userService.resetPassword(session.user, resetMatch[1], body.password);
        await repositories.apiKeys.revokeAllByOwner(resetMatch[1]);
        return json({ ok: true });
    }
    const userStatusMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    if (request.method === "PUT" && userStatusMatch) {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        const body = await readJson(request);
        const user = await userService.setDisabled(
            session.user,
            userStatusMatch[1],
            body.disabled,
        );
        if (user.disabled) {
            await repositories.apiKeys.revokeAllByOwner(user.id);
        }
        return json({ user: publicUser(user) });
    }
    if (request.method === "PUT" && path === "/api/admin/site-settings") {
        const body = await readJson(request);
        return json({ site: await siteSettingsService.update(session.user, body) });
    }
    if (["GET", "PUT"].includes(request.method) && path === "/api/admin/retention") {
        if (session.authType !== "session") {
            throw new AppError(403, "A browser login session is required", "session_required");
        }
        if (request.method === "GET") {
            return json({ retention: await retentionService.get(session.user) });
        }
        const body = await readJson(request);
        return json({
            retention: await retentionService.update(session.user, body.retentionDays),
        });
    }
    throw new AppError(404, "API route not found", "not_found");
}

async function handleRequest(request, env, context) {
    const url = new URL(request.url);
    const publicRoute = routePublicResource(url.pathname);
    const publicNamespace = url.pathname === "/pub" || url.pathname.startsWith("/pub/");
    const retiredPublicPath = /^\/(?:file|text)(?:\/|$)/.test(url.pathname)
        || /^\/pub_[^/]*(?:\/|$)/.test(url.pathname);
    if ((publicNamespace && !publicRoute) || retiredPublicPath) {
        return publicNotFound(request);
    }
    const needsData = url.pathname.startsWith("/api/") || Boolean(publicRoute);
    if (!needsData) {
        return env.ASSETS.fetch(request);
    }
    await ensureSchema(env.DB);
    const repositories = createRepositories(env.DB);

    if (publicRoute && ["GET", "HEAD"].includes(request.method)) {
        return servePublicResource({
            request,
            bucket: env.BUCKET,
            repository: repositories.resources,
            route: publicRoute,
            cache: globalThis.caches?.default || null,
            context,
        });
    }
    if (url.pathname.startsWith("/api/")) {
        return handleApi(request, env, repositories);
    }
    return publicNotFound(request);
}

export default {
    async fetch(request, env, context) {
        try {
            return await handleRequest(request, env, context);
        } catch (error) {
            if (error instanceof AppError) {
                return json({ error: { code: error.code, message: error.message } }, error.status);
            }
            console.error(error);
            return json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
        }
    },

    async scheduled(_controller, env) {
        await ensureSchema(env.DB);
        const repositories = createRepositories(env.DB);
        const retention = createRetentionService(repositories.settings, env.BUCKET);
        const result = await retention.run();
        console.log(`Retention scanned ${result.scanned} objects and deleted ${result.deleted}`);
    },
};
