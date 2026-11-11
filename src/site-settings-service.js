import { AppError, requireAdministrator } from "./errors.js";

export const DEFAULT_SITE_SETTINGS = Object.freeze({
    faviconUrl: "",
    siteTitle: "ImgHub",
    siteTagline: "Your files. Stable links.",
    welcomeTitle: "A small cloud shelf for the things you share.",
    welcomeDescription: "Private accounts, isolated storage, and links that survive content replacement.",
});

const fields = {
    faviconUrl: { key: "site_favicon_url" },
    siteTitle: { key: "site_title", label: "Site title", max: 48 },
    siteTagline: { key: "site_tagline", label: "Site tagline", max: 100 },
    welcomeTitle: { key: "site_welcome_title", label: "Welcome title", max: 120 },
    welcomeDescription: { key: "site_welcome_description", label: "Welcome description", max: 240 },
};

function validateFaviconUrl(input) {
    if (input === undefined) return "";
    const invalid = () => new AppError(400, "Favicon must be an HTTPS URL or a site-relative path (up to 2048 characters)", "invalid_site_settings");
    if (typeof input !== "string") throw invalid();
    const value = input.trim();
    if (!value) return "";
    if (value.length > 2048 || /[\s\\]/u.test(value)) throw invalid();
    let url;
    try {
        url = new URL(value, "https://imghub.invalid");
    } catch {
        throw invalid();
    }
    const sitePath = value.startsWith("/") && !value.startsWith("//");
    if ((!sitePath && !value.startsWith("https://")) || url.protocol !== "https:" || url.username || url.password) {
        throw invalid();
    }
    return value;
}

function validate(input) {
    return Object.fromEntries(Object.entries(fields).map(([name, field]) => {
        if (name === "faviconUrl") return [name, validateFaviconUrl(input?.[name])];
        const value = typeof input?.[name] === "string"
            ? input[name].trim().replace(/\s+/g, " ")
            : "";
        if (!value || value.length > field.max) {
            throw new AppError(
                400,
                `${field.label} must be between 1 and ${field.max} characters`,
                "invalid_site_settings",
            );
        }
        return [name, value];
    }));
}

export function createSiteSettingsService(repository) {
    return {
        async get() {
            const entries = await Promise.all(Object.entries(fields).map(async ([name, field]) => [
                name,
                await repository.get(field.key) || DEFAULT_SITE_SETTINGS[name],
            ]));
            return Object.fromEntries(entries);
        },

        async update(user, input) {
            requireAdministrator(user);
            const settings = validate(input);
            await Promise.all(Object.entries(fields).map(([name, field]) => (
                repository.set(field.key, settings[name])
            )));
            return settings;
        },
    };
}
