import {
    LANGUAGE_STORAGE_KEY,
    resolveLanguage,
    translate,
    translations,
} from "./i18n.js";
import { buildShareFormats, filesFromClipboard, generateRandomPassword } from "./ui-utils.js";
import { md5File } from "./md5.js";

function savedLanguage() {
    try {
        return localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
        return null;
    }
}

const state = {
    user: null,
    site: null,
    language: resolveLanguage(navigator.languages || [navigator.language], savedLanguage()),
    resources: [],
    uploadMode: "file",
    resourceDirectory: null,
    resourceView: "grid",
    history: [],
    lastShareFormats: null,
    editingTextId: null,
    turnstileSiteKey: null,
    turnstileWidgetId: null,
    turnstileScript: null,
    auditPage: { page: 1, pageSize: 20, query: "", total: 0, totalPages: 1 },
    userPage: { page: 1, pageSize: 20, query: "", total: 0, totalPages: 1 },
};

const byId = (id) => document.getElementById(id);
const show = (element, visible = true) => { element.hidden = !visible; };
const t = (key, values) => translate(state.language, key, values);

function translatedError(code, fallback, status) {
    const key = `error.${code}`;
    if (code && Object.hasOwn(translations[state.language], key)) return t(key);
    if (code && Object.hasOwn(translations.en, key)) return t(key);
    return fallback || t("error.requestFailed", { status });
}

function localizedSiteValue(field, value) {
    const defaults = {
        siteTagline: [translations.en["site.defaultTagline"], "site.defaultTagline"],
        welcomeTitle: [translations.en["site.defaultWelcomeTitle"], "site.defaultWelcomeTitle"],
        welcomeDescription: [translations.en["site.defaultWelcomeDescription"], "site.defaultWelcomeDescription"],
    };
    const [englishDefault, key] = defaults[field] || [];
    return key && value === englishDefault ? t(key) : value;
}

function applyTranslations() {
    document.documentElement.lang = state.language;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
        const values = node.dataset.i18nDays ? { days: node.dataset.i18nDays } : undefined;
        node.textContent = t(node.dataset.i18n, values);
    });
    for (const [attribute, target] of [
        ["i18nPlaceholder", "placeholder"],
        ["i18nTitle", "title"],
        ["i18nAriaLabel", "aria-label"],
    ]) {
        document.querySelectorAll(`[data-${attribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`)
            .forEach((node) => node.setAttribute(target, t(node.dataset[attribute])));
    }
    document.querySelectorAll("[data-language]").forEach((button) => {
        const active = button.dataset.language === state.language;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function setLanguage(language, persist = true) {
    state.language = language === "zh-CN" ? "zh-CN" : "en";
    if (persist) {
        try {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, state.language);
        } catch {
            // The selected language still applies for this page when storage is unavailable.
        }
    }
    applyTranslations();
    if (state.site) applySiteSettings(state.site);
    if (state.user) {
        byId("profile-role").textContent = t(`role.${state.user.role}`);
        renderResources();
        renderHistory();
        const activeView = document.querySelector(".nav-button.active")?.dataset.view;
        if (["admin", "audit", "users", "api-keys"].includes(activeView)) switchView(activeView);
    }
}

function notify(message, error = false, duration = 4200) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.classList.toggle("error", error);
    show(toast);
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => show(toast, false), duration);
}

let refreshSessionPromise = null;

async function refreshSession() {
    if (!refreshSessionPromise) {
        refreshSessionPromise = fetch("/api/auth/refresh", { method: "POST" })
            .then((response) => response.ok)
            .catch(() => false)
            .finally(() => { refreshSessionPromise = null; });
    }
    return refreshSessionPromise;
}

async function api(path, options = {}, allowRefresh = true) {
    const request = { method: options.method || "GET", headers: { ...options.headers } };
    if (options.body instanceof FormData) {
        request.body = options.body;
    } else if (options.body !== undefined) {
        request.headers["Content-Type"] = "application/json";
        request.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, request);
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    const excluded = ["/api/auth/login", "/api/auth/logout", "/api/auth/refresh", "/api/setup"];
    if (response.status === 401 && allowRefresh && !excluded.includes(path) && await refreshSession()) {
        return api(path, options, false);
    }
    if (!response.ok) {
        const error = new Error(translatedError(
            payload?.error?.code,
            payload?.error?.message,
            response.status,
        ));
        error.status = response.status;
        error.code = payload?.error?.code;
        throw error;
    }
    return payload;
}

function importResponseError(payload, status) {
    const error = new Error(translatedError(
        payload?.error?.code,
        payload?.error?.message,
        status,
    ));
    error.status = payload?.error?.status || status;
    error.code = payload?.error?.code;
    return error;
}

async function remoteImportRequest(body, onProgress, allowRefresh = true) {
    const response = await fetch("/api/files/import", {
        method: "POST",
        headers: {
            Accept: "application/x-ndjson",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (response.status === 401 && allowRefresh && await refreshSession()) {
        return remoteImportRequest(body, onProgress, false);
    }
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw importResponseError(payload, response.status);
    }
    if (!(response.headers.get("Content-Type") || "").includes("application/x-ndjson")) {
        const payload = await response.json().catch(() => null);
        if (payload?.resource) return payload;
        throw importResponseError(payload, response.status);
    }
    if (!response.body) throw importResponseError(null, response.status);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let resource = null;
    const consume = (line) => {
        if (!line.trim()) return;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            throw importResponseError(null, response.status);
        }
        if (event.type === "progress") onProgress(event);
        if (event.type === "complete") {
            resource = event.resource;
            onProgress({ type: "progress", phase: "complete", percent: 100 });
        }
        if (event.type === "error") throw importResponseError(event, event.error?.status || response.status);
    };

    while (true) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = lines.pop() || "";
        for (const line of lines) consume(line);
        if (done) break;
    }
    consume(buffered);
    if (!resource) throw importResponseError(null, response.status);
    return { resource };
}

function formBody(form) {
    return Object.fromEntries(new FormData(form));
}

function hidePasswords(form) {
    form.querySelectorAll('input[type="text"][name*="assword"], input[type="password"]').forEach((input) => {
        input.type = "password";
    });
    form.querySelectorAll("[data-password-toggle]").forEach((button) => button.classList.remove("active"));
}

async function submit(form, operation, onError) {
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
        await operation();
    } catch (error) {
        let displayedError = error;
        if (onError) {
            try {
                await onError(error);
            } catch (handlerError) {
                displayedError = handlerError;
            }
        }
        notify(displayedError.message, true);
    } finally {
        button.disabled = false;
    }
}

async function loadTurnstileApi() {
    if (globalThis.turnstile) return globalThis.turnstile;
    if (!state.turnstileScript) {
        state.turnstileScript = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            script.defer = true;
            script.addEventListener("load", () => resolve(globalThis.turnstile));
            script.addEventListener("error", () => reject(new Error(t("error.turnstile_load_failed"))));
            document.head.append(script);
        }).catch((error) => {
            state.turnstileScript = null;
            throw error;
        });
    }
    return state.turnstileScript;
}

async function showLoginTurnstile() {
    if (!state.turnstileSiteKey) {
        throw new Error(t("error.turnstile_unavailable"));
    }
    const token = byId("login-turnstile-token");
    token.value = "";
    show(byId("login-turnstile"));
    const turnstile = await loadTurnstileApi();
    if (state.turnstileWidgetId !== null) {
        turnstile.reset(state.turnstileWidgetId);
        return;
    }
    state.turnstileWidgetId = turnstile.render("#login-turnstile-widget", {
        sitekey: state.turnstileSiteKey,
        action: "login",
        theme: "auto",
        callback: (value) => { token.value = value; },
        "expired-callback": () => { token.value = ""; },
        "error-callback": () => {
            token.value = "";
            notify(t("error.turnstile_failed"), true);
            return true;
        },
    });
}

function resetLoginTurnstile() {
    byId("login-turnstile-token").value = "";
    show(byId("login-turnstile"), false);
    if (state.turnstileWidgetId !== null && globalThis.turnstile) {
        globalThis.turnstile.reset(state.turnstileWidgetId);
    }
}

function resetShells() {
    show(byId("auth-shell"), false);
    show(byId("password-gate"), false);
    show(byId("app-shell"), false);
}

function showAuthentication(panel) {
    state.user = null;
    resetShells();
    show(byId("auth-shell"));
    show(byId("setup-panel"), panel === "setup");
    show(byId("login-panel"), panel === "login");
}

function applySiteSettings(site) {
    state.site = site;
    document.title = site.siteTitle;
    document.querySelector('meta[name="description"]').content = localizedSiteValue(
        "welcomeDescription",
        site.welcomeDescription,
    );
    document.querySelectorAll(".site-title-slot").forEach((element) => {
        element.textContent = site.siteTitle;
    });
    byId("site-tagline").textContent = localizedSiteValue("siteTagline", site.siteTagline);
    byId("site-welcome-title").textContent = localizedSiteValue("welcomeTitle", site.welcomeTitle);
    byId("site-welcome-description").textContent = localizedSiteValue(
        "welcomeDescription",
        site.welcomeDescription,
    );
}

function applyUser(user) {
    state.user = user;
    resetShells();
    if (user.mustChangePassword) {
        show(byId("password-gate"));
        return;
    }
    byId("profile-name").textContent = user.username;
    byId("profile-role").textContent = t(`role.${user.role}`);
    byId("profile-initial").textContent = user.username.charAt(0).toUpperCase();
    document.querySelectorAll("[data-admin-only]").forEach((element) => {
        show(element, user.role === "admin");
    });
    show(byId("app-shell"));
    switchView("upload");
}

async function initialize() {
    try {
        const [setup, settings] = await Promise.all([
            api("/api/setup/status"),
            api("/api/site-settings"),
        ]);
        state.turnstileSiteKey = setup.turnstileSiteKey;
        applySiteSettings(settings.site);
        if (!setup.initialized) {
            showAuthentication("setup");
            return;
        }
        try {
            const session = await api("/api/auth/me");
            applyUser(session.user);
        } catch (error) {
            if (error.status !== 401) throw error;
            showAuthentication("login");
        }
    } catch (error) {
        showAuthentication("login");
        notify(t("message.startFailed", { message: error.message }), true);
    }
}

function clearShareResult() {
    state.lastShareFormats = null;
    byId("upload-share-name").textContent = "";
    show(byId("upload-share-result"), false);
}

function switchView(name) {
    clearShareResult();
    if (["admin", "audit", "users"].includes(name) && state.user?.role !== "admin") return;
    document.querySelectorAll(".view").forEach((view) => show(view, view.id === `view-${name}`));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    if (name === "upload") selectUploadMode(state.uploadMode);
    if (name === "manager") loadResources();
    if (name === "api-keys") loadApiKeys();
    if (name === "admin") loadAdministration();
    if (name === "audit") loadAudit();
    if (name === "users") loadUsers();
    if (name === "history") loadHistory();
}

function updateModeTabs(prefix, mode, kinds) {
    for (const kind of kinds) {
        const selected = kind === mode;
        const tab = byId(`${prefix}-${kind}-tab`);
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
        show(byId(`${prefix}-${kind}-panel`), selected);
    }
}

function selectUploadMode(mode) {
    clearShareResult();
    const modes = ["file", "text", "remote"];
    state.uploadMode = modes.includes(mode) ? mode : "file";
    updateModeTabs("upload", state.uploadMode, modes);
}

function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function actionButton(label, title, handler) {
    const button = element("button", "", label);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", handler);
    return button;
}

function resourcePreview(resource) {
    let preview = null;
    if (resource.kind === "file" && resource.contentType?.startsWith("image/") && resource.contentType !== "image/svg+xml") {
        preview = document.createElement("img");
        preview.alt = "";
    } else if (resource.kind === "text") {
        preview = document.createElement("iframe");
        preview.title = t("resource.textPreview", { name: resource.name });
        preview.setAttribute("sandbox", "");
        preview.tabIndex = -1;
    }
    if (!preview) return null;
    preview.className = "resource-preview";
    preview.src = resource.url;
    preview.loading = "lazy";
    return preview;
}

function renderResources() {
    const target = byId("resource-list");
    target.replaceChildren();
    target.classList.toggle("list-mode", state.resourceView === "list");
    const resources = state.resourceDirectory === null
        ? state.resources
        : state.resources.filter((resource) => (
            resource.directory === state.resourceDirectory
            || resource.directory.startsWith(`${state.resourceDirectory}/`)
        ));
    renderDirectoryTree();
    if (!resources.length) {
        target.append(element("div", "empty-state", t("resource.empty")));
        return;
    }
    for (const resource of resources) {
        const card = element("article", "resource-card");
        const icon = element("div", "resource-icon", resource.kind === "file" ? "◫" : "¶");
        const preview = resourcePreview(resource);
        if (preview) {
            icon.classList.add("has-preview");
            icon.replaceChildren(preview);
        }
        card.append(icon);
        const meta = element("div", "resource-meta");
        const link = element("a", "", resource.name);
        link.href = resource.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        meta.append(link);
        meta.append(element(
            "small",
            "",
            `${resource.directory || t("resource.root")} · ${formatBytes(resource.size)} · v${resource.version}${resource.textFormat && resource.textFormat !== "plain" ? ` · ${t(`texts.${resource.textFormat}`)}` : ""}`,
        ));
        card.append(meta);
        const actions = element("div", "resource-actions");
        actions.append(actionButton("URL", t("resource.copyUrl"), () => copyShare(resource, "url")));
        actions.append(actionButton("MD", t("resource.copyMarkdown"), () => copyShare(resource, "markdown")));
        actions.append(actionButton("</>", t("resource.copyHtml"), () => copyShare(resource, "html")));
        actions.append(actionButton("↺", t("resource.replace"), () => replaceResource(resource)));
        actions.append(actionButton("×", t("resource.delete"), () => deleteResource(resource)));
        card.append(actions);
        target.append(card);
    }
}

function renderDirectoryTree() {
    const target = byId("directory-tree");
    if (!target) return;
    target.replaceChildren();
    const directories = new Set();
    for (const resource of state.resources) {
        const parts = resource.directory.split("/").filter(Boolean);
        for (let index = 1; index <= parts.length; index += 1) {
            directories.add(parts.slice(0, index).join("/"));
        }
    }
    const appendDirectory = (directory, label, depth = 0) => {
        const button = element("button", state.resourceDirectory === directory ? "active" : "", label);
        button.type = "button";
        button.title = directory || t("manager.allResources");
        button.style.paddingLeft = `${9 + depth * 13}px`;
        button.addEventListener("click", () => {
            state.resourceDirectory = directory;
            byId("file-directory").value = directory || "";
            byId("text-form").elements.directory.value = directory || "";
            byId("remote-file-form").elements.directory.value = directory || "";
            byId("resource-manager-title").textContent = directory || t("manager.allResources");
            renderResources();
        });
        target.append(button);
    };
    appendDirectory(null, t("manager.allResources"));
    for (const directory of [...directories].sort((left, right) => left.localeCompare(right))) {
        appendDirectory(directory, directory.split("/").at(-1), directory.split("/").length - 1);
    }
}

async function loadResources() {
    try {
        const result = await api("/api/resources");
        state.resources = result.resources;
        renderResources();
    } catch (error) {
        if (error.status === 401) showAuthentication("login");
        else notify(error.message, true);
    }
}

const copySuccessTimers = new WeakMap();

function animateCopySuccess(feedbackElement) {
    if (!feedbackElement) return;
    clearTimeout(copySuccessTimers.get(feedbackElement));
    feedbackElement.classList.remove("copy-success");
    void feedbackElement.offsetWidth;
    feedbackElement.classList.add("copy-success");
    copySuccessTimers.set(feedbackElement, setTimeout(() => {
        feedbackElement.classList.remove("copy-success");
        copySuccessTimers.delete(feedbackElement);
    }, 650));
}

async function copyText(value, message = t("message.urlCopied"), {
    duration = 4200,
    feedbackElement,
} = {}) {
    try {
        await navigator.clipboard.writeText(value);
        animateCopySuccess(feedbackElement);
        notify(message, false, duration);
    } catch {
        window.prompt(t("resource.copyPrompt"), value);
    }
}

async function copyUrl(url) {
    return copyText(url);
}

function showShareResult(resource) {
    state.lastShareFormats = buildShareFormats(resource);
    byId("upload-share-name").textContent = resource.name;
    show(byId("upload-share-result"));
}

function copyShare(resource, format) {
    const formats = buildShareFormats(resource);
    return copyText(formats[format], t("message.shareCopied", { format: format.toUpperCase() }));
}

async function replaceResource(resource) {
    if (resource.kind === "file") {
        const picker = document.createElement("input");
        picker.type = "file";
        picker.addEventListener("change", async () => {
            if (!picker.files?.length) return;
            const file = picker.files[0];
            const body = new FormData();
            try {
                const contentMd5 = await md5File(file, (fraction) => {
                    updateUploadProgress(file, fraction * 0.1, "files.checkingDuplicate");
                });
                body.set("file", file);
                body.set("md5", contentMd5);
                const result = await uploadRequest(
                    `/api/resources/${encodeURIComponent(resource.id)}/content`,
                    body,
                    (fraction) => updateUploadProgress(file, 0.1 + fraction * 0.9),
                    "PUT",
                );
                showShareResult(result.resource);
                notify(t("resource.fileReplaced"));
                await loadHistory();
                await loadResources();
            } catch (error) {
                notify(error.message, true);
            } finally {
                setTimeout(() => show(byId("file-upload-progress"), false), 700);
            }
        }, { once: true });
        picker.click();
        return;
    }
    try {
        const result = await api(`/api/resources/${encodeURIComponent(resource.id)}/content`);
        switchView("upload");
        selectUploadMode("text");
        const form = byId("text-form");
        form.elements.name.value = resource.name;
        form.elements.directory.value = resource.directory;
        form.elements.format.value = resource.textFormat === "rich" ? "rich" : "markdown";
        updateTextEditorMode();
        if ((resource.textFormat || "plain") === "rich") {
            byId("rich-text-editor").innerHTML = result.content;
        } else {
            form.elements.content.value = result.content;
        }
        state.editingTextId = resource.id;
        byId("text-submit").textContent = t("texts.update");
        show(byId("cancel-text-edit"));
        form.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        notify(error.message, true);
    }
}

async function deleteResource(resource) {
    if (!window.confirm(t("resource.deleteConfirm", { name: resource.name }))) return;
    try {
        await api(`/api/resources/${encodeURIComponent(resource.id)}`, { method: "DELETE" });
        notify(t("resource.deleted", { name: resource.name }));
        await loadHistory();
        await loadResources();
    } catch (error) {
        notify(error.message, true);
    }
}

function uploadRequest(path, formData, onProgress, method = "POST", allowRefresh = true) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open(method, path);
        request.responseType = "json";
        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        });
        request.addEventListener("load", async () => {
            const payload = request.response;
            if (request.status >= 200 && request.status < 300) {
                resolve(payload);
                return;
            }
            if (request.status === 401 && allowRefresh && await refreshSession()) {
                try {
                    resolve(await uploadRequest(path, formData, onProgress, method, false));
                } catch (error) {
                    reject(error);
                }
                return;
            }
            const error = new Error(translatedError(
                payload?.error?.code,
                payload?.error?.message,
                request.status,
            ));
            error.status = request.status;
            reject(error);
        });
        request.addEventListener("error", () => reject(new Error(t("error.requestFailed", { status: 0 }))));
        request.send(formData);
    });
}

function updateUploadProgress(file, fraction, labelKey = "files.uploading") {
    const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    byId("file-upload-label").textContent = t(labelKey, { name: file.name });
    byId("file-upload-percent").textContent = `${percent}%`;
    byId("file-upload-meter").value = percent;
    show(byId("file-upload-progress"));
}

function updateRemoteProgress(event) {
    const label = byId("remote-upload-label");
    const percent = byId("remote-upload-percent");
    const meter = byId("remote-upload-meter");
    show(byId("remote-upload-progress"));
    if (event.phase === "saving") {
        label.textContent = t("files.remoteSaving");
        percent.textContent = "…";
        meter.removeAttribute("value");
        return;
    }
    if (event.phase === "complete") {
        label.textContent = t("message.remoteImported");
        percent.textContent = "100%";
        meter.value = 100;
        return;
    }
    label.textContent = t(event.phase === "fetching" ? "files.remoteFetching" : "files.remoteConnecting");
    if (Number.isFinite(event.percent)) {
        percent.textContent = `${event.percent}%`;
        meter.value = event.percent;
    } else {
        percent.textContent = event.loaded ? formatBytes(event.loaded) : "…";
        meter.removeAttribute("value");
    }
}

async function uploadFiles(files) {
    const selected = [...files];
    if (!selected.length) return;
    const picker = byId("file-picker");
    if (picker.disabled) return;
    const directory = byId("file-directory").value;
    picker.disabled = true;
    try {
        for (let index = 0; index < selected.length; index += 1) {
            const file = selected[index];
            const contentMd5 = await md5File(file, (fraction) => {
                updateUploadProgress(
                    file,
                    (index + fraction * 0.1) / selected.length,
                    "files.checkingDuplicate",
                );
            });
            const instant = await api("/api/files/instant", {
                method: "POST",
                body: {
                    directory,
                    md5: contentMd5,
                    name: file.name,
                    size: file.size,
                },
            });
            if (instant.resource) {
                updateUploadProgress(
                    file,
                    (index + 1) / selected.length,
                    "files.instantUploaded",
                );
                showShareResult(instant.resource);
                continue;
            }
            const body = new FormData();
            body.set("directory", directory);
            body.set("file", file);
            body.set("md5", contentMd5);
            const result = await uploadRequest("/api/files", body, (fraction) => {
                updateUploadProgress(file, (index + 0.1 + fraction * 0.9) / selected.length);
            });
            showShareResult(result.resource);
        }
        notify(t("message.fileUploaded"));
        await Promise.all([loadResources(), loadHistory()]);
    } catch (error) {
        notify(error.message, true);
    } finally {
        picker.disabled = false;
        picker.value = "";
        setTimeout(() => show(byId("file-upload-progress"), false), 700);
    }
}

function renderHistory() {
    const target = byId("history-list");
    if (!target) return;
    target.replaceChildren();
    if (!state.history.length) {
        target.append(element("div", "empty-state", t("history.empty")));
        return;
    }
    for (const event of [...state.history].reverse()) {
        const item = element("article", "history-item");
        const content = element("div");
        const title = element("strong", "", `${t(`history.${event.action}`)} · ${event.name}`);
        if (!event.resourceDeleted) {
            const link = element("a", "", title.textContent);
            link.href = event.url;
            link.target = "_blank";
            link.rel = "noreferrer";
            title.replaceChildren(link);
        }
        content.append(title);
        const details = [
            event.kind === "file" ? t("audit.file") : t("audit.text"),
            event.directory || t("resource.root"),
            `v${event.version}`,
            event.resourceDeleted ? t("history.deleted") : null,
        ].filter(Boolean).join(" · ");
        content.append(element("small", "", details));
        item.append(content);
        item.append(element("time", "history-time", new Date(event.createdAt).toLocaleString(state.language)));
        target.append(item);
    }
}

async function loadHistory() {
    if (!state.user || state.user.mustChangePassword) return;
    try {
        const result = await api("/api/history");
        state.history = result.events;
        renderHistory();
    } catch (error) {
        if (error.status === 401) showAuthentication("login");
        else notify(error.message, true);
    }
}

async function loadAdministration() {
    try {
        const [settings, retention] = await Promise.all([
            api("/api/site-settings"),
            api("/api/admin/retention"),
        ]);
        const siteForm = byId("site-settings-form");
        for (const [name, value] of Object.entries(settings.site)) {
            siteForm.elements[name].value = value;
        }
        byId("retention-form").elements.retentionDays.value = retention.retention.retentionDays;
    } catch (error) {
        notify(error.message, true);
    }
}

function managementQuery(path, pageState) {
    const parameters = new URLSearchParams({
        page: String(pageState.page),
        pageSize: String(pageState.pageSize),
    });
    if (pageState.query) parameters.set("q", pageState.query);
    return `${path}?${parameters}`;
}

function updatePagination(prefix, pageState) {
    byId(`${prefix}-page-summary`).textContent = t("pagination.summary", pageState);
    byId(`${prefix}-page-previous`).disabled = pageState.page <= 1;
    byId(`${prefix}-page-next`).disabled = pageState.page >= pageState.totalPages;
}

async function loadAudit() {
    try {
        const result = await api(managementQuery("/api/admin/resources", state.auditPage));
        Object.assign(state.auditPage, result.pagination);
        renderAudit(result.resources);
        updatePagination("audit", state.auditPage);
    } catch (error) {
        notify(error.message, true);
    }
}

async function loadUsers() {
    try {
        const result = await api(managementQuery("/api/admin/users", state.userPage));
        Object.assign(state.userPage, result.pagination);
        renderUsers(result.users);
        updatePagination("user", state.userPage);
    } catch (error) {
        notify(error.message, true);
    }
}

function renderAudit(resources) {
    const target = byId("audit-list");
    target.replaceChildren();
    if (!resources.length) {
        target.append(element("div", "empty-state", t("audit.empty")));
        return;
    }
    for (const resource of resources) {
        const row = element("article", "audit-row");
        const identity = element("div", "audit-identity");
        const status = element(
            "span",
            `status-badge${resource.blockedAt ? " blocked" : ""}`,
            t(resource.blockedAt ? "audit.blocked" : "audit.active"),
        );
        identity.append(status);
        if (resource.blockedAt) {
            identity.append(element("code", "audit-link blocked", resource.url));
        } else {
            const link = element("a", "audit-link", resource.url);
            link.href = resource.url;
            link.target = "_blank";
            link.rel = "noreferrer";
            identity.append(link);
        }
        const details = element("div", "audit-details");
        details.append(element("span", "", t(`audit.${resource.kind}`)));
        details.append(element("span", "", t("audit.uploadedBy", { username: resource.ownerUsername })));
        details.append(element("span", "", new Date(resource.createdAt).toLocaleString(state.language)));
        if (resource.blockedAt) {
            details.append(element(
                "span",
                "",
                t("audit.blockedBy", { username: resource.blockedByUsername || "—" }),
            ));
        }
        identity.append(details);
        row.append(identity);
        if (!resource.blockedAt) {
            const block = element("button", "danger", t("audit.block"));
            block.type = "button";
            block.addEventListener("click", () => blockResource(resource));
            row.append(block);
        }
        target.append(row);
    }
}

async function blockResource(resource) {
    if (!window.confirm(t("audit.blockConfirm", { url: resource.url }))) return;
    try {
        await api(`/api/admin/resources/${encodeURIComponent(resource.id)}/block`, { method: "POST" });
        notify(t("audit.blockDone"));
        await loadAudit();
    } catch (error) {
        notify(error.message, true);
    }
}

function renderUsers(users) {
    const target = byId("user-list");
    target.replaceChildren();
    if (!users.length) {
        target.append(element("div", "empty-state", t("user.empty")));
        return;
    }
    for (const user of users) {
        const row = element("div", "user-row");
        const identity = element("span");
        identity.append(element("strong", "", user.username));
        identity.append(element(
            "small",
            "",
            [
                t(`role.${user.role}`),
                t(user.disabled ? "user.disabled" : "user.active"),
                user.mustChangePassword ? t("user.passwordPending") : null,
            ].filter(Boolean).join(" · "),
        ));
        row.append(identity);
        if (user.role !== "admin") {
            const actions = element("div", "row-actions");
            const reset = element("button", "secondary", t("user.resetPassword"));
            reset.type = "button";
            reset.addEventListener("click", () => resetUserPassword(user));
            actions.append(reset);
            const toggle = element(
                "button",
                user.disabled ? "secondary" : "danger",
                t(user.disabled ? "user.enable" : "user.disable"),
            );
            toggle.type = "button";
            toggle.addEventListener("click", () => setUserDisabled(user, !user.disabled));
            actions.append(toggle);
            row.append(actions);
        }
        target.append(row);
    }
}

async function setUserDisabled(user, disabled) {
    const confirmation = t(
        disabled ? "user.disableConfirm" : "user.enableConfirm",
        { username: user.username },
    );
    if (!window.confirm(confirmation)) return;
    try {
        await api(`/api/admin/users/${encodeURIComponent(user.id)}/status`, {
            method: "PUT",
            body: { disabled },
        });
        notify(t(disabled ? "user.disabledDone" : "user.enabledDone", { username: user.username }));
        await loadUsers();
    } catch (error) {
        notify(error.message, true);
    }
}

async function resetUserPassword(user) {
    const dialog = byId("password-reset-dialog");
    const form = byId("reset-password-form");
    form.reset();
    form.dataset.userId = user.id;
    form.dataset.username = user.username;
    byId("reset-password-user").textContent = user.username;
    dialog.showModal();
}

async function loadApiKeys() {
    try {
        const result = await api("/api/api-keys");
        const target = byId("api-key-list");
        target.replaceChildren();
        for (const apiKey of result.apiKeys) {
            const row = element("div", "user-row");
            const identity = element("span");
            identity.append(element("strong", "", apiKey.name));
            const expiry = apiKey.expiresAt
                ? t("apiKey.expires", { date: new Date(apiKey.expiresAt).toLocaleDateString(state.language) })
                : t("apiKey.neverExpires");
            identity.append(element(
                "small",
                "",
                `${apiKey.prefix}… · ${apiKey.revokedAt ? t("apiKey.revoked") : expiry}`,
            ));
            row.append(identity);
            if (!apiKey.revokedAt) {
                const revoke = element("button", "secondary", t("apiKey.revoke"));
                revoke.type = "button";
                revoke.addEventListener("click", async () => {
                    if (!window.confirm(t("apiKey.revokeConfirm", { name: apiKey.name }))) return;
                    try {
                        await api(`/api/api-keys/${encodeURIComponent(apiKey.id)}`, { method: "DELETE" });
                        notify(t("message.apiKeyRevoked"));
                        await loadApiKeys();
                    } catch (error) {
                        notify(error.message, true);
                    }
                });
                row.append(revoke);
            }
            target.append(row);
        }
    } catch (error) {
        notify(error.message, true);
    }
}

byId("setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const result = await api("/api/setup", { method: "POST", body: formBody(form) });
        form.reset();
        hidePasswords(form);
        applyUser(result.user);
        notify(t("message.initialized"));
    });
});

byId("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const body = formBody(form);
        body.turnstileToken = byId("login-turnstile-token").value;
        const result = await api("/api/auth/login", { method: "POST", body });
        form.reset();
        resetLoginTurnstile();
        hidePasswords(form);
        applyUser(result.user);
    }, async (error) => {
        if (["turnstile_required", "turnstile_failed"].includes(error.code)) {
            await showLoginTurnstile();
        }
    });
});

async function changePassword(form) {
    const result = await api("/api/auth/password", { method: "POST", body: formBody(form) });
    form.reset();
    hidePasswords(form);
    applyUser(result.user);
    notify(t("message.passwordUpdated"));
}

byId("first-password-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, () => changePassword(form));
});

byId("password-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, () => changePassword(form));
});

byId("api-key-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const body = formBody(form);
        body.expiresInDays = body.expiresInDays ? Number(body.expiresInDays) : null;
        const result = await api("/api/api-keys", { method: "POST", body });
        byId("new-api-key-value").textContent = result.token;
        show(byId("new-api-key"));
        form.reset();
        await loadApiKeys();
    });
});

byId("copy-api-key").addEventListener("click", () => copyUrl(byId("new-api-key-value").textContent));

byId("file-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    uploadFiles(form.elements.file.files);
});

byId("file-picker").addEventListener("change", (event) => uploadFiles(event.currentTarget.files));

for (const eventName of ["dragenter", "dragover"]) {
    byId("file-drop-zone").addEventListener(eventName, (event) => {
        event.preventDefault();
        event.currentTarget.classList.add("dragging");
    });
}
for (const eventName of ["dragleave", "drop"]) {
    byId("file-drop-zone").addEventListener(eventName, (event) => {
        event.preventDefault();
        event.currentTarget.classList.remove("dragging");
    });
}
byId("file-drop-zone").addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));

byId("file-drop-zone").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    byId("file-picker").click();
});

function isEditablePasteTarget(target) {
    return target instanceof Element && (
        target.matches("input, textarea, select")
        || target.isContentEditable
        || Boolean(target.closest("[contenteditable='true']"))
    );
}

document.addEventListener("paste", (event) => {
    if (byId("view-upload").hidden || byId("upload-file-panel").hidden) return;
    if (isEditablePasteTarget(event.target)) return;
    const files = filesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    const dropZone = byId("file-drop-zone");
    dropZone.classList.add("pasting");
    window.setTimeout(() => dropZone.classList.remove("pasting"), 350);
    uploadFiles(files);
});

document.querySelectorAll("[data-share-copy]").forEach((button) => {
    button.addEventListener("click", () => {
        const format = button.dataset.shareCopy;
        if (state.lastShareFormats) {
            copyText(
                state.lastShareFormats[format],
                t("message.shareCopied", { format: format.toUpperCase() }),
            );
        }
    });
});

byId("dismiss-upload-share").addEventListener("click", clearShareResult);

byId("remote-file-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        updateRemoteProgress({ phase: "connecting", loaded: 0, total: null, percent: null });
        try {
            const result = await remoteImportRequest(formBody(form), updateRemoteProgress);
            showShareResult(result.resource);
            form.reset();
            notify(t("message.remoteImported"));
            await Promise.all([loadResources(), loadHistory()]);
        } finally {
            setTimeout(() => show(byId("remote-upload-progress"), false), 700);
        }
    });
});

function updateTextEditorMode() {
    const rich = byId("text-format").value === "rich";
    show(byId("plain-text-field"), !rich);
    show(byId("rich-text-field"), rich);
    byId("rich-text-toolbar").classList.toggle("inactive", !rich);
    byId("rich-text-toolbar").setAttribute("aria-hidden", String(!rich));
    byId("text-content").required = !rich;
}

function resetTextEditor() {
    const form = byId("text-form");
    form.reset();
    byId("rich-text-editor").replaceChildren();
    state.editingTextId = null;
    byId("text-submit").textContent = t("texts.publish");
    show(byId("cancel-text-edit"), false);
    updateTextEditorMode();
}

byId("text-format").addEventListener("change", updateTextEditorMode);
document.querySelectorAll("[data-rich-command]").forEach((button) => {
    button.addEventListener("click", () => {
        byId("rich-text-editor").focus();
        document.execCommand(button.dataset.richCommand, false, button.dataset.richValue || null);
    });
});
byId("cancel-text-edit").addEventListener("click", resetTextEditor);

byId("text-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const body = formBody(form);
        if (body.format === "rich") body.content = byId("rich-text-editor").innerHTML.trim();
        if (!body.content) throw new Error(t("error.text_required"));
        const editing = state.editingTextId;
        const result = await api(editing ? `/api/resources/${encodeURIComponent(editing)}/content` : "/api/texts", {
            method: editing ? "PUT" : "POST",
            body,
        });
        showShareResult(result.resource);
        resetTextEditor();
        notify(t(editing ? "resource.textReplaced" : "message.textPublished"));
        await Promise.all([loadResources(), loadHistory()]);
    });
});

byId("user-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const body = formBody(form);
        await api("/api/admin/users", { method: "POST", body });
        form.reset();
        hidePasswords(form);
        byId("user-create-drawer").close();
        notify(t("user.created", { username: body.username }));
        await loadUsers();
    });
});

byId("open-user-create").addEventListener("click", () => {
    const drawer = byId("user-create-drawer");
    const form = byId("user-form");
    form.reset();
    hidePasswords(form);
    drawer.showModal();
    form.elements.username.focus();
});
byId("close-user-create").addEventListener("click", () => byId("user-create-drawer").close());
byId("user-create-drawer").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

function generateForForm(form) {
    const password = generateRandomPassword();
    form.elements.password.value = password;
    form.elements.confirmPassword.value = password;
    form.elements.password.type = "text";
    form.elements.confirmPassword.type = "text";
    form.querySelectorAll("[data-password-toggle]").forEach((button) => button.classList.add("active"));
    return password;
}

byId("generate-user-password").addEventListener("click", () => {
    const password = generateForForm(byId("user-form"));
    return copyText(password, t("message.passwordGeneratedCopied"), { duration: 2000 });
});
byId("copy-user-password").addEventListener("click", (event) => copyText(
    byId("user-form").elements.password.value,
    t("message.passwordCopied"),
    { duration: 2000, feedbackElement: event.currentTarget },
));

byId("generate-reset-password").addEventListener("click", () => generateForForm(byId("reset-password-form")));
byId("copy-reset-password").addEventListener("click", (event) => copyText(
    byId("reset-password-form").elements.password.value,
    t("message.passwordCopied"),
    { duration: 2000, feedbackElement: event.currentTarget },
));
byId("cancel-password-reset").addEventListener("click", () => byId("password-reset-dialog").close());
byId("reset-password-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const username = form.dataset.username;
        await api(`/api/admin/users/${encodeURIComponent(form.dataset.userId)}/reset-password`, {
            method: "POST",
            body: formBody(form),
        });
        byId("password-reset-dialog").close();
        form.reset();
        hidePasswords(form);
        notify(t("user.resetDone", { username }));
        await loadUsers();
    });
});

byId("audit-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.auditPage.query = form.elements.q.value.trim();
    state.auditPage.page = 1;
    loadAudit();
});

byId("user-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.userPage.query = form.elements.q.value.trim();
    state.userPage.page = 1;
    loadUsers();
});

byId("site-settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const result = await api("/api/admin/site-settings", {
            method: "PUT",
            body: formBody(form),
        });
        applySiteSettings(result.site);
        notify(t("message.appearanceUpdated"));
    });
});

byId("retention-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async () => {
        const retentionDays = Number(form.elements.retentionDays.value);
        await api("/api/admin/retention", {
            method: "PUT",
            body: { retentionDays },
        });
        notify(t("message.retentionUpdated", { days: retentionDays }));
    });
});

document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
});

function changeManagementPage(pageState, delta, loader) {
    const nextPage = pageState.page + delta;
    if (nextPage < 1 || nextPage > pageState.totalPages) return;
    pageState.page = nextPage;
    loader();
}

byId("audit-refresh").addEventListener("click", loadAudit);
byId("user-refresh").addEventListener("click", loadUsers);
byId("audit-page-previous").addEventListener("click", () => (
    changeManagementPage(state.auditPage, -1, loadAudit)
));
byId("audit-page-next").addEventListener("click", () => (
    changeManagementPage(state.auditPage, 1, loadAudit)
));
byId("user-page-previous").addEventListener("click", () => (
    changeManagementPage(state.userPage, -1, loadUsers)
));
byId("user-page-next").addEventListener("click", () => (
    changeManagementPage(state.userPage, 1, loadUsers)
));
byId("history-refresh").addEventListener("click", loadHistory);
byId("manager-refresh").addEventListener("click", loadResources);

function setResourceView(mode) {
    state.resourceView = mode === "list" ? "list" : "grid";
    byId("resource-grid-view").classList.toggle("active", state.resourceView === "grid");
    byId("resource-list-view").classList.toggle("active", state.resourceView === "list");
    renderResources();
}

byId("resource-grid-view").addEventListener("click", () => setResourceView("grid"));
byId("resource-list-view").addEventListener("click", () => setResourceView("list"));

byId("upload-file-tab").addEventListener("click", () => selectUploadMode("file"));
byId("upload-text-tab").addEventListener("click", () => selectUploadMode("text"));
byId("upload-remote-tab").addEventListener("click", () => selectUploadMode("remote"));

function passwordEyeIcon(className, paths, circle = false) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("password-eye", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const pathData of paths) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.append(path);
    }
    if (circle) {
        const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        pupil.setAttribute("cx", "12");
        pupil.setAttribute("cy", "12");
        pupil.setAttribute("r", "3");
        svg.append(pupil);
    }
    return svg;
}

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.replaceChildren(
        passwordEyeIcon("password-eye-open", ["M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"], true),
        passwordEyeIcon("password-eye-closed", [
            "M3 3l18 18",
            "M10.6 5.6A10.5 10.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a14 14 0 0 1-2.2 3.2",
            "M6.1 6.1A14 14 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.8 9.8 0 0 0 3.4-.6",
        ]),
    );
    button.addEventListener("click", () => {
        const input = button.closest(".password-field").querySelector("input");
        input.type = input.type === "password" ? "text" : "password";
        button.classList.toggle("active", input.type === "text");
    });
});

document.querySelectorAll(".logout-button").forEach((button) => {
    button.addEventListener("click", async () => {
        try {
            await api("/api/auth/logout", { method: "POST" });
        } finally {
            showAuthentication("login");
        }
    });
});

document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
});

applyTranslations();
updateTextEditorMode();
selectUploadMode(state.uploadMode);
initialize();
