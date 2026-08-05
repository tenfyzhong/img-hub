const extensionApi = globalThis.browser ?? globalThis.chrome;

const elements = Object.fromEntries([
    "connection-form", "deployment-url", "connection-status", "login-form", "username",
    "password", "workspace", "current-user", "logout-button", "upload-form", "directory",
    "image-file", "refresh-button", "empty-state", "resource-list", "message", "replacement-file",
].map((id) => [id, document.getElementById(id)]));

let state = { deploymentUrl: "", accessToken: "", username: "" };
let replacementResourceId = null;

function normalizeDeploymentUrl(value) {
    const url = new URL(value.trim());
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
        throw new Error("Use HTTPS unless the deployment is running on localhost.");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Enter only the deployment origin, without a path.");
    }
    return url.origin;
}

function hostPermission(origin) {
    return `${origin}/*`;
}

async function requestDeploymentAccess(origin) {
    const granted = await extensionApi.permissions.request({ origins: [hostPermission(origin)] });
    if (!granted) {
        throw new Error("Permission to connect to this deployment was not granted.");
    }
}

async function saveState(patch) {
    state = { ...state, ...patch };
    await extensionApi.storage.local.set(state);
    renderSession();
}

function setMessage(message, success = false) {
    elements.message.textContent = message;
    elements.message.classList.toggle("success", success);
}

async function api(path, options = {}) {
    if (!state.deploymentUrl) {
        throw new Error("Configure the deployment URL first.");
    }
    const headers = new Headers(options.headers || {});
    if (state.accessToken) {
        headers.set("Authorization", `Bearer ${state.accessToken}`);
    }
    const response = await fetch(`${state.deploymentUrl}${path}`, { ...options, headers });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401) {
            await saveState({ accessToken: "", username: "" });
        }
        const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
        error.code = payload?.error?.code;
        throw error;
    }
    return payload;
}

function renderSession() {
    elements["deployment-url"].value = state.deploymentUrl;
    elements["connection-status"].textContent = state.deploymentUrl
        ? `Connected to ${state.deploymentUrl}`
        : "Choose the deployment this browser should use.";
    const signedIn = Boolean(state.accessToken);
    elements["login-form"].hidden = signedIn;
    elements.workspace.hidden = !signedIn;
    elements["current-user"].textContent = state.username;
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
        name.textContent = resource.name;
        const path = document.createElement("span");
        path.className = "resource-path";
        path.textContent = resource.directory || "/";
        const actions = document.createElement("div");
        actions.className = "resource-actions";
        actions.append(
            actionButton("Copy", "copy", resource.id),
            actionButton("Replace", "replace", resource.id),
            actionButton("Delete", "delete", resource.id, true),
        );
        item.dataset.url = resource.url;
        item.append(name, path, actions);
        elements["resource-list"].append(item);
    }
}

async function loadResources() {
    const payload = await api("/api/resources?kind=file");
    renderResources(payload.resources);
}

elements["connection-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        const deploymentUrl = normalizeDeploymentUrl(elements["deployment-url"].value);
        await requestDeploymentAccess(deploymentUrl);
        const changed = deploymentUrl !== state.deploymentUrl;
        await saveState({
            deploymentUrl,
            ...(changed ? { accessToken: "", username: "" } : {}),
        });
        setMessage("Deployment saved.", true);
    } catch (error) {
        setMessage(error.message);
    }
});

elements["login-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        const deploymentUrl = normalizeDeploymentUrl(elements["deployment-url"].value);
        await requestDeploymentAccess(deploymentUrl);
        await saveState({ deploymentUrl });
        const payload = await api("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: elements.username.value,
                password: elements.password.value,
                client: "extension",
            }),
        });
        elements.password.value = "";
        await saveState({ accessToken: payload.accessToken, username: payload.user.username });
        setMessage("Signed in.", true);
        await loadResources();
    } catch (error) {
        if (["turnstile_required", "turnstile_failed"].includes(error.code)) {
            setMessage("Open the ImgHub website, complete login verification, then retry here.");
        } else {
            setMessage(error.message);
        }
    }
});

elements["logout-button"].addEventListener("click", async () => {
    try {
        await api("/api/auth/logout", { method: "POST" });
        setMessage("Signed out.", true);
    } catch (error) {
        setMessage(`Local session cleared. ${error.message}`);
    } finally {
        await saveState({ accessToken: "", username: "" });
        renderResources([]);
    }
});

elements["upload-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        const form = new FormData();
        form.set("directory", elements.directory.value);
        form.set("file", elements["image-file"].files[0]);
        const payload = await api("/api/files", { method: "POST", body: form });
        elements["image-file"].value = "";
        await navigator.clipboard.writeText(payload.resource.url);
        setMessage("Uploaded. The public URL is on your clipboard.", true);
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
            setMessage("Public URL copied.", true);
        } else if (button.dataset.action === "replace") {
            replacementResourceId = button.dataset.resourceId;
            elements["replacement-file"].click();
        } else if (button.dataset.action === "delete") {
            if (!confirm("Permanently delete this image?")) return;
            await api(`/api/resources/${encodeURIComponent(button.dataset.resourceId)}`, { method: "DELETE" });
            setMessage("Image deleted.", true);
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
        const form = new FormData();
        form.set("file", file);
        const payload = await api(`/api/resources/${encodeURIComponent(replacementResourceId)}/content`, {
            method: "PUT",
            body: form,
        });
        await navigator.clipboard.writeText(payload.resource.url);
        setMessage("Image replaced. The refreshed URL is on your clipboard.", true);
        await loadResources();
    } catch (error) {
        setMessage(error.message);
    } finally {
        elements["replacement-file"].value = "";
        replacementResourceId = null;
    }
});

async function initialize() {
    state = { ...state, ...await extensionApi.storage.local.get(["deploymentUrl", "accessToken", "username"]) };
    renderSession();
    if (state.accessToken) {
        await loadResources();
    }
}

initialize().catch((error) => setMessage(error.message));
