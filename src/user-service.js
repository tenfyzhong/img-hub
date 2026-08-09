import { hashPassword, validatePassword, verifyPassword } from "./auth.js";
import { AppError, requireAdministrator } from "./errors.js";
import { normalizePageOptions, paginated } from "./pagination.js";

function createId(prefix) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export const ADMIN_USERNAME = "admin";

export function normalizeUsername(value) {
    const username = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
        throw new AppError(
            400,
            "Username must be 3-32 lowercase letters, numbers, underscores, or hyphens",
            "invalid_username",
        );
    }
    return username;
}

export function createUserService(repository) {
    return {
        async createUser(actor, rawUsername, password) {
            requireAdministrator(actor);
            const username = normalizeUsername(rawUsername);
            if (username === ADMIN_USERNAME || await repository.isUsernameReserved(username)) {
                throw new AppError(400, "The username admin is reserved", "username_reserved");
            }
            validatePassword(password);
            if (await repository.findByUsername(username)) {
                throw new AppError(409, "Username already exists", "username_exists");
            }
            return repository.create({
                id: createId("usr"),
                username,
                passwordHash: await hashPassword(password),
                role: "user",
                mustChangePassword: true,
                disabled: false,
            });
        },

        async resetPassword(actor, userId, password) {
            requireAdministrator(actor);
            validatePassword(password);
            const target = await repository.findById(userId);
            if (!target) {
                throw new AppError(404, "User not found", "user_not_found");
            }
            if (target.role === "admin") {
                throw new AppError(400, "The administrator password must be changed by the administrator", "admin_reset_denied");
            }
            const passwordHash = await hashPassword(password);
            await repository.updatePassword(userId, passwordHash, true);
            target.passwordHash = passwordHash;
            target.mustChangePassword = true;
            await repository.deleteSessions(userId);
        },

        async changePassword(actor, currentPassword, newPassword, currentTokenHash) {
            if (!actor) {
                throw new AppError(401, "Authentication is required", "authentication_required");
            }
            if (!await verifyPassword(currentPassword, actor.passwordHash)) {
                throw new AppError(400, "Current password is incorrect", "incorrect_password");
            }
            validatePassword(newPassword);
            if (await verifyPassword(newPassword, actor.passwordHash)) {
                throw new AppError(400, "New password must be different", "password_unchanged");
            }
            const passwordHash = await hashPassword(newPassword);
            await repository.updatePassword(actor.id, passwordHash, false);
            actor.passwordHash = passwordHash;
            actor.mustChangePassword = false;
            await repository.deleteSessions(actor.id, currentTokenHash);
        },

        async listUsers(actor) {
            requireAdministrator(actor);
            return repository.list();
        },

        async listUsersPage(actor, input) {
            requireAdministrator(actor);
            const options = normalizePageOptions(input);
            const result = await repository.listPage(options);
            return paginated(result.items, result.total, options);
        },

        async setDisabled(actor, userId, disabled) {
            requireAdministrator(actor);
            if (typeof disabled !== "boolean") {
                throw new AppError(400, "Disabled state must be a boolean", "invalid_disabled_state");
            }
            const target = await repository.findById(userId);
            if (!target) {
                throw new AppError(404, "User not found", "user_not_found");
            }
            if (target.role === "admin") {
                throw new AppError(400, "The administrator account cannot be disabled", "admin_disable_denied");
            }
            if (target.disabled === disabled) return target;
            const updated = await repository.setDisabled(userId, disabled);
            if (disabled) {
                await repository.deleteSessions(userId);
            }
            return updated;
        },
    };
}
