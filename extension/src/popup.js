import { tryWriteClipboard } from "./clipboard.js";
import { md5File } from "./md5.js";
import { filesFromClipboard } from "./ui-utils.js";
import {
    LANGUAGE_STORAGE_KEY,
    resolveLanguage,
    translate,
    translations,
} from "./i18n.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;

const elements = Object.fromEntries([
    "login-form", "deployment-url", "username", "password", "workspace", "current-user",
    "deployment-link", "logout-button", "upload-file-tab", "upload-text-tab", "upload-remote-tab",
    "upload-file-panel", "upload-text-panel", "upload-remote-panel", "file-upload-form",
    "file-directory", "file-drop-zone", "file-picker", "text-form", "text-format", "markdown-content-field",
    "markdown-content", "rich-content-field", "rich-content", "remote-file-form", "refresh-button",
    "selected-files", "recent-card", "recent-loading", "empty-state", "resource-list", "message",
    "replacement-file",
].map((id) => [id, document.getElementById(id)]));

const uploadModes = ["file", "text", "remote"];
let state = {
    deploymentUrl: "",
    accessToken: "",
    username: "",
    language: resolveLanguage(navigator.languages || [navigator.language]),
};
let replacementResourceId = null;
let recentResources = [];
let pendingResourceLoads = 0;
let selectedUploadFiles = [];
let fileUploadInProgress = false;

const t = (key, values) => translate(state.language, key, values);

function updateSelectedFiles(files = selectedUploadFiles) {
    selectedUploadFiles = [...files];
    const count = selectedUploadFiles.length;
    const key = count === 0
        ? "extension.noFilesSelected"
        : count === 1 ? "extension.oneFileSelected" : "extension.manyFilesSelected";
    elements["selected-files"].textContent = t(key, { count });
}

function applyTranslations() {
    document.documentElement.lang = state.language;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
        node.textContent = t(node.dataset.i18n);
    });
    for (const [datasetName, attribute] of [
        ["i18nPlaceholder", "placeholder"],
        ["i18nAriaLabel", "aria-label"],
    ]) {
        const selector = `[data-${datasetName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`;
        document.querySelectorAll(selector).forEach((node) => {
            node.setAttribute(attribute, t(node.dataset[datasetName]));
        });
    }
    document.querySelectorAll("[data-language]").forEach((button) => {
        const active = button.dataset.language === state.language;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    updateSelectedFiles();
    if (recentResources.length) renderResources(recentResources);
}

async function setLanguage(language) {
    state.language = language === "zh-CN" ? "zh-CN" : "en";
    await extensionApi.storage.local.set({ [LANGUAGE_STORAGE_KEY]: state.language });
    applyTranslations();
}

function normalizeDeploymentUrl(value) {
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error(t("extension.error.originOnly"));
    }
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
        throw new Error(t("extension.error.httpsOnly"));
    }
    if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error(t("extension.error.originOnly"));
    }
    return url.origin;
}

function hostPermission(origin) {
    return `${origin}/*`;
}

async function requestDeploymentAccess(origin) {
    const granted = await extensionApi.permissions.request({ origins: [hostPermission(origin)] });
    if (!granted) {
        throw new Error(t("extension.error.permissionDenied"));
    }
}

async function saveState(patch) {
    state = { ...state, ...patch };
    await extensionApi.storage.local.set({
        deploymentUrl: state.deploymentUrl,
        accessToken: state.accessToken,
        username: state.username,
    });
    renderSession();
}

function setMessage(message, success = false) {
    elements.message.textContent = message;
    elements.message.classList.toggle("success", success);
}

function setRecentLoading(loading) {
    pendingResourceLoads = Math.max(0, pendingResourceLoads + (loading ? 1 : -1));
    const isLoading = pendingResourceLoads > 0;
    elements["recent-loading"].hidden = !isLoading;
    elements["recent-card"].setAttribute("aria-busy", String(isLoading));
    elements["refresh-button"].disabled = isLoading;
}

async function responsePayload(response) {
    return response.status === 204 ? null : response.json().catch(() => null);
}

function responseError(response, payload) {
    const code = payload?.error?.code;
    const key = code ? `error.${code}` : null;
    const localizedMessage = key && Object.hasOwn(translations[state.language], key) ? t(key) : null;
    const error = new Error(localizedMessage || payload?.error?.message || t("error.requestFailed", {
        status: response.status,
    }));
    error.code = code;
    error.status = response.status;
    return error;
}

async function api(path, options = {}) {
    if (!state.deploymentUrl) {
        throw new Error(t("extension.error.signInFirst"));
    }
    const headers = new Headers(options.headers || {});
    if (state.accessToken) {
        headers.set("Authorization", `Bearer ${state.accessToken}`);
    }
    let body = options.body;
    if (body !== undefined && !(body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(body);
    }
    const response = await fetch(`${state.deploymentUrl}${path}`, { ...options, body, headers });
    const payload = await responsePayload(response);
    if (!response.ok) {
        if (response.status === 401) {
            await saveState({ accessToken: "" });
            const error = new Error(t("extension.error.sessionExpired"));
            error.code = payload?.error?.code;
            error.status = response.status;
            throw error;
        }
        throw responseError(response, payload);
    }
    return payload;
}

async function signIn(deploymentUrl, username, password) {
    const response = await fetch(`${deploymentUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, client: "extension" }),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw responseError(response, payload);
    return payload;
}

function renderSession() {
    elements["deployment-url"].value = state.deploymentUrl;
    elements.username.value = state.username;
    const signedIn = Boolean(state.accessToken);
    elements["login-form"].hidden = signedIn;
    elements.workspace.hidden = !signedIn;
    elements["current-user"].textContent = state.username;
    elements["deployment-link"].href = state.deploymentUrl || "#";
}

function selectUploadMode(mode) {
    for (const candidate of uploadModes) {
        const selected = candidate === mode;
        elements[`upload-${candidate}-tab`].classList.toggle("active", selected);
        elements[`upload-${candidate}-tab`].setAttribute("aria-selected", String(selected));
        elements[`upload-${candidate}-panel`].hidden = !selected;
    }
}

function updateTextEditorMode() {
    const rich = elements["text-format"].value === "rich";
    elements["markdown-content-field"].hidden = rich;
    elements["rich-content-field"].hidden = !rich;
    elements["markdown-content"].required = !rich;
}

function actionButton(label, action, resourceId, dangerous = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.resourceId = resourceId;
    button.classList.toggle("danger", dangerous);
    return button;
}

function renderResources(resources) {
    elements["resource-list"].replaceChildren();
    elements["empty-state"].hidden = resources.length > 0;
    for (const resource of resources) {
        const item = document.createElement("li");
        item.className = "resource";

        const name = document.createElement("span");
        name.className = "resource-name";
        const link = document.createElement("a");
        link.href = resource.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = resource.name;
        name.append(link);

        const path = document.createElement("span");
        path.className = "resource-path";
        const kind = document.createElement("span");
        kind.className = "resource-kind";
        kind.textContent = t(`extension.kind.${resource.kind}`);
        path.append(kind, resource.directory || "/");

        const actions = document.createElement("div");
        actions.className = "resource-actions";
        actions.append(actionButton(t("extension.action.copy"), "copy", resource.id));
        if (resource.kind === "file") {
            actions.append(actionButton(t("extension.action.replace"), "replace", resource.id));
        }
        actions.append(actionButton(t("extension.action.delete"), "delete", resource.id, true));

        item.dataset.url = resource.url;
        item.append(name, path, actions);
        elements["resource-list"].append(item);
    }
}

async function loadResources() {
    setRecentLoading(true);
    try {
        const payload = await api("/api/resources");
        const recentUploads = [...payload.resources]
            .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
            .slice(0, 10);
        recentResources = recentUploads;
        renderResources(recentUploads);
    } finally {
        setRecentLoading(false);
    }
}

async function uploadFile(file, directory) {
    setMessage(t("extension.checkingUpload", { name: file.name }));
    const md5 = await md5File(file);
    const instant = await api("/api/files/instant", {
        method: "POST",
        body: { directory, md5, name: file.name, size: file.size },
    });
    if (instant.resource) return instant.resource;

    const form = new FormData();
    form.set("directory", directory);
    form.set("file", file);
    form.set("md5", md5);
    const payload = await api("/api/files", { method: "POST", body: form });
    return payload.resource;
}

async function uploadFiles(files) {
    const selected = [...files];
    if (!selected.length || fileUploadInProgress) return;
    fileUploadInProgress = true;
    updateSelectedFiles(selected);
    elements["file-picker"].disabled = true;
    elements["file-drop-zone"].classList.add("uploading");
    try {
        let latestResource;
        for (const file of selected) {
            latestResource = await uploadFile(file, elements["file-directory"].value);
        }
        const copied = await tryWriteClipboard(navigator.clipboard, latestResource.url);
        const messageKey = selected.length === 1
            ? copied ? "extension.uploadedOne" : "extension.uploadedOneNotCopied"
            : copied ? "extension.uploadedMany" : "extension.uploadedManyNotCopied";
        setMessage(t(messageKey, {
            count: selected.length,
        }), true);
        await loadResources();
    } catch (error) {
        setMessage(error.message);
    } finally {
        elements["file-picker"].disabled = false;
        elements["file-picker"].value = "";
        elements["file-drop-zone"].classList.remove("uploading");
        fileUploadInProgress = false;
        updateSelectedFiles([]);
    }
}

for (const mode of uploadModes) {
    elements[`upload-${mode}-tab`].addEventListener("click", () => selectUploadMode(mode));
}

document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => {
        setLanguage(button.dataset.language).catch((error) => setMessage(error.message));
    });
});

elements["text-format"].addEventListener("change", updateTextEditorMode);
elements["file-picker"].addEventListener("change", (event) => uploadFiles(event.currentTarget.files));

for (const eventName of ["dragenter", "dragover"]) {
    elements["file-drop-zone"].addEventListener(eventName, (event) => {
        event.preventDefault();
        if (!fileUploadInProgress) event.currentTarget.classList.add("dragging");
    });
}
for (const eventName of ["dragleave", "drop"]) {
    elements["file-drop-zone"].addEventListener(eventName, (event) => {
        event.preventDefault();
        event.currentTarget.classList.remove("dragging");
    });
}
elements["file-drop-zone"].addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));
elements["file-drop-zone"].addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    elements["file-picker"].click();
});

function isEditablePasteTarget(target) {
    return target instanceof Element && (
        target.matches("input, textarea, select")
        || target.isContentEditable
        || Boolean(target.closest("[contenteditable='true']"))
    );
}

document.addEventListener("paste", (event) => {
    if (elements.workspace.hidden || elements["upload-file-panel"].hidden) return;
    if (isEditablePasteTarget(event.target)) return;
    const files = filesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    elements["file-drop-zone"].classList.add("pasting");
    window.setTimeout(() => elements["file-drop-zone"].classList.remove("pasting"), 350);
    uploadFiles(files);
});

elements["login-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        const deploymentUrl = normalizeDeploymentUrl(elements["deployment-url"].value);
        const username = elements.username.value.trim();
        await requestDeploymentAccess(deploymentUrl);
        const payload = await signIn(deploymentUrl, username, elements.password.value);
        elements.password.value = "";
        await saveState({
            deploymentUrl,
            accessToken: payload.accessToken,
            username: payload.user.username,
        });
        setMessage(t("extension.signedIn"), true);
        await loadResources();
    } catch (error) {
        if (["turnstile_required", "turnstile_failed"].includes(error.code)) {
            setMessage(t("extension.turnstileInstruction"));
        } else {
            setMessage(error.message);
        }
    }
});

elements["logout-button"].addEventListener("click", async () => {
    try {
        await api("/api/auth/logout", { method: "POST" });
        setMessage(t("extension.signedOut"), true);
    } catch (error) {
        setMessage(t("extension.localSessionCleared", { message: error.message }));
    } finally {
        await saveState({ accessToken: "" });
        renderResources([]);
    }
});

elements["file-upload-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    await uploadFiles(elements["file-picker"].files);
});

elements["text-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const format = form.elements.format.value;
    const content = format === "rich"
        ? elements["rich-content"].innerHTML.trim()
        : elements["markdown-content"].value;
    if (!content.trim()) {
        setMessage(t("extension.textRequired"));
        return;
    }
    try {
        const payload = await api("/api/texts", {
            method: "POST",
            body: {
                name: form.elements.name.value,
                directory: form.elements.directory.value,
                format,
                content,
            },
        });
        form.reset();
        elements["rich-content"].replaceChildren();
        updateTextEditorMode();
        const copied = await tryWriteClipboard(navigator.clipboard, payload.resource.url);
        setMessage(t(copied ? "extension.textPublished" : "extension.textPublishedNotCopied"), true);
        await loadResources();
    } catch (error) {
        setMessage(error.message);
    }
});

elements["remote-file-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
        setMessage(t("extension.remoteFetching"));
        const payload = await api("/api/files/import", {
            method: "POST",
            body: {
                url: form.elements.url.value,
                directory: form.elements.directory.value,
            },
        });
        form.reset();
        const copied = await tryWriteClipboard(navigator.clipboard, payload.resource.url);
        setMessage(t(copied ? "extension.remoteUploaded" : "extension.remoteUploadedNotCopied"), true);
        await loadResources();
    } catch (error) {
        setMessage(error.message);
    }
});

elements["refresh-button"].addEventListener("click", () => {
    loadResources().catch((error) => setMessage(error.message));
});

elements["resource-list"].addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = button.closest(".resource");
    try {
        if (button.dataset.action === "copy") {
            await navigator.clipboard.writeText(item.dataset.url);
            setMessage(t("extension.urlCopied"), true);
        } else if (button.dataset.action === "replace") {
            replacementResourceId = button.dataset.resourceId;
            elements["replacement-file"].click();
        } else if (button.dataset.action === "delete") {
            if (!confirm(t("extension.deleteConfirm"))) return;
            await api(`/api/resources/${encodeURIComponent(button.dataset.resourceId)}`, { method: "DELETE" });
            setMessage(t("extension.uploadDeleted"), true);
            await loadResources();
        }
    } catch (error) {
        setMessage(error.message);
    }
});

elements["replacement-file"].addEventListener("change", async () => {
    const file = elements["replacement-file"].files[0];
    if (!file || !replacementResourceId) return;
    try {
        const md5 = await md5File(file);
        const form = new FormData();
        form.set("file", file);
        form.set("md5", md5);
        const payload = await api(`/api/resources/${encodeURIComponent(replacementResourceId)}/content`, {
            method: "PUT",
            body: form,
        });
        const copied = await tryWriteClipboard(navigator.clipboard, payload.resource.url);
        setMessage(t(copied ? "extension.fileReplaced" : "extension.fileReplacedNotCopied"), true);
        await loadResources();
    } catch (error) {
        setMessage(error.message);
    } finally {
        elements["replacement-file"].value = "";
        replacementResourceId = null;
    }
});

async function initialize() {
    const stored = await extensionApi.storage.local.get([
        "deploymentUrl",
        "accessToken",
        "username",
        LANGUAGE_STORAGE_KEY,
    ]);
    state = {
        ...state,
        deploymentUrl: stored.deploymentUrl || "",
        accessToken: stored.accessToken || "",
        username: stored.username || "",
        language: resolveLanguage(
            navigator.languages || [navigator.language],
            stored[LANGUAGE_STORAGE_KEY],
        ),
    };
    applyTranslations();
    renderSession();
    updateTextEditorMode();
    if (state.accessToken) await loadResources();
}

initialize().catch((error) => setMessage(error.message));
