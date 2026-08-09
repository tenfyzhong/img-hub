export class AppError extends Error {
    constructor(status, message, code = "request_error") {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
    }
}

export function requireAdministrator(user) {
    if (!user || user.role !== "admin") {
        throw new AppError(403, "Administrator access is required", "administrator_required");
    }
}

export function requireActiveUser(user) {
    if (!user) {
        throw new AppError(401, "Authentication is required", "authentication_required");
    }
    if (user.disabled) {
        throw new AppError(403, "This account is disabled", "account_disabled");
    }
    if (user.mustChangePassword) {
        throw new AppError(403, "You must change your password before continuing", "password_change_required");
    }
}

export function requireOwner(user, resource) {
    if (!resource || resource.createdBy !== user?.id) {
        throw new AppError(403, "Only the resource owner may perform this operation", "owner_required");
    }
}
