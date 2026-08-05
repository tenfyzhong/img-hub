import { AppError, requireActiveUser, requireAdministrator, requireOwner } from "./errors.js";
import { buildObjectKey, buildPublicUrl, normalizeDirectory, sanitizeFileName } from "./paths.js";
import { normalizeTextFormat, sanitizeRichText } from "./text-format.js";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

function createId() {
    return `res_${crypto.randomUUID().replaceAll("-", "")}`;
}

function createPublicId() {
    return `pub_${crypto.randomUUID().replaceAll("-", "")}`;
}

function createEvent(resource, action, sourceUrl = null, resourceId = resource.id) {
    return {
        id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
        createdBy: resource.createdBy,
        resourceId,
        action,
        kind: resource.kind,
        publicId: resource.publicId,
        directory: resource.directory,
        name: resource.name,
        version: resource.version,
        sourceUrl,
        resourceDeleted: action === "delete",
        createdAt: new Date().toISOString(),
    };
}

function validateSize(kind, size) {
    const normalized = Number(size);
    const maximum = kind === "text" ? MAX_TEXT_BYTES : MAX_FILE_BYTES;
    if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > maximum) {
        throw new AppError(400, `${kind === "text" ? "Text" : "File"} size is invalid or too large`, "invalid_size");
    }
    return normalized;
}

function sanitizeStoredContent(kind, textFormat, content) {
    if (kind !== "text" || textFormat !== "rich") return content;
    const decoded = typeof content === "string" ? content : new TextDecoder().decode(content);
    return new TextEncoder().encode(sanitizeRichText(decoded));
}

function withUrl(resource, origin) {
    return {
        ...resource,
        url: buildPublicUrl(origin, resource.kind, resource.publicId, resource.version),
    };
}

export function createResourceService(repository, bucket) {
    return {
        async create(user, input) {
            requireActiveUser(user);
            const kind = input.kind;
            if (kind !== "file" && kind !== "text") {
                throw new AppError(400, "Resource kind must be file or text", "invalid_kind");
            }
            const directory = normalizeDirectory(input.directory);
            const name = sanitizeFileName(input.name);
            const textFormat = kind === "text" ? normalizeTextFormat(input.textFormat) : "plain";
            const content = sanitizeStoredContent(kind, textFormat, input.content);
            const size = validateSize(
                kind,
                kind === "text" && textFormat === "rich" ? content.byteLength : input.size,
            );
            const id = createId();
            const publicId = createPublicId();
            const objectKey = buildObjectKey(user.id, kind, directory, name);
            const resource = {
                id,
                kind,
                createdBy: user.id,
                objectKey,
                publicId,
                directory,
                name,
                contentType: input.contentType || (kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream"),
                textFormat,
                size,
                version: 1,
            };
            try {
                await repository.create(resource);
            } catch (error) {
                if (/unique|constraint/i.test(String(error?.message))) {
                    throw new AppError(409, "A resource with this name already exists in the directory", "resource_exists");
                }
                throw error;
            }
            try {
                await bucket.put(objectKey, content, {
                    httpMetadata: { contentType: resource.contentType },
                    customMetadata: { createdBy: user.id, resourceId: id },
                });
                await repository.addEvent(createEvent(
                    resource,
                    input.eventAction === "import" ? "import" : "upload",
                    input.sourceUrl || null,
                ));
            } catch (error) {
                await bucket.delete(objectKey);
                await repository.delete(id);
                throw error;
            }
            return withUrl(resource, input.origin);
        },

        async list(user, kind) {
            requireActiveUser(user);
            if (kind && kind !== "file" && kind !== "text") {
                throw new AppError(400, "Resource kind must be file or text", "invalid_kind");
            }
            return repository.listByOwner(user.id, kind);
        },

        async delete(user, resourceId) {
            requireActiveUser(user);
            const resource = await repository.findById(resourceId);
            if (resource?.blockedAt) {
                throw new AppError(404, "Resource not found", "resource_not_found");
            }
            requireOwner(user, resource);
            await bucket.delete(resource.objectKey);
            await repository.delete(resource.id);
            await repository.addEvent(createEvent(resource, "delete", null, null));
        },

        async getContent(user, resourceId) {
            requireActiveUser(user);
            const resource = await repository.findById(resourceId);
            if (resource?.blockedAt) {
                throw new AppError(404, "Resource not found", "resource_not_found");
            }
            requireOwner(user, resource);
            if (resource.kind !== "text") {
                throw new AppError(400, "Only text content can be loaded for editing", "resource_type_mismatch");
            }
            const object = await bucket.get(resource.objectKey);
            if (!object) {
                throw new AppError(404, "Resource not found", "resource_not_found");
            }
            const content = await object.text();
            return {
                resource,
                content: resource.textFormat === "rich" ? sanitizeRichText(content) : content,
            };
        },

        async replace(user, resourceId, input) {
            requireActiveUser(user);
            const resource = await repository.findById(resourceId);
            if (resource?.blockedAt) {
                throw new AppError(404, "Resource not found", "resource_not_found");
            }
            requireOwner(user, resource);
            if (input.kind && input.kind !== resource.kind) {
                throw new AppError(400, "Replacement must keep the existing resource type", "resource_type_mismatch");
            }
            const version = Number(resource.version) + 1;
            const contentType = input.contentType || resource.contentType;
            const textFormat = resource.kind === "text"
                ? normalizeTextFormat(input.textFormat || resource.textFormat)
                : "plain";
            const content = sanitizeStoredContent(resource.kind, textFormat, input.content);
            const size = validateSize(
                resource.kind,
                resource.kind === "text" && textFormat === "rich" ? content.byteLength : input.size,
            );
            await bucket.put(resource.objectKey, content, {
                httpMetadata: { contentType },
                customMetadata: { createdBy: user.id, resourceId: resource.id, version: String(version) },
            });
            const updated = await repository.updateContent(resource.id, {
                contentType,
                textFormat,
                size,
                version,
            });
            await repository.addEvent(createEvent(updated, "replace"));
            return withUrl(updated, input.origin);
        },

        async listForAudit(user, origin) {
            requireAdministrator(user);
            const resources = await repository.listForAudit();
            return resources.map((resource) => withUrl(resource, origin));
        },

        async listHistory(user, origin) {
            requireActiveUser(user);
            const events = await repository.listEventsByOwner(user.id);
            return events.map((event) => ({
                ...event,
                resourceDeleted: event.action === "delete" || event.resourceDeleted,
                url: buildPublicUrl(origin, event.kind, event.publicId, event.version),
            }));
        },

        async block(user, resourceId) {
            requireAdministrator(user);
            const resource = await repository.findById(resourceId);
            if (!resource) {
                throw new AppError(404, "Resource not found", "resource_not_found");
            }
            if (resource.blockedAt) return resource;
            await bucket.delete(resource.objectKey);
            return repository.block(resource.id, user.id, new Date().toISOString());
        },
    };
}
