function parseWranglerJson(result, operation) {
    try {
        return JSON.parse(result.stdout);
    } catch {
        throw new Error(`Wrangler returned invalid JSON while trying to ${operation}`);
    }
}

export function normalizeTurnstileDomains(value) {
    const domains = Array.isArray(value) ? value : String(value || "").split(",");
    const normalized = domains
        .map((domain) => String(domain).trim().toLowerCase().replace(/\.$/, ""))
        .filter(Boolean);
    for (const domain of normalized) {
        if (domain.includes("/") || /\s/.test(domain)) {
            throw new Error(`Invalid Turnstile hostname: ${domain}`);
        }
    }
    const uniqueDomains = [...new Set(normalized)];
    if (uniqueDomains.length > 10) {
        throw new Error("Turnstile supports at most 10 hostnames per widget");
    }
    return uniqueDomains;
}

export function findWorkerHostname(output) {
    return String(output).match(/https:\/\/([a-z0-9.-]+\.workers\.dev)(?:[/:\s]|$)/i)?.[1]
        ?.toLowerCase() || null;
}

export function ensureTurnstileWidgetWithWrangler({ name, domains, wrangler }) {
    const desiredDomains = normalizeTurnstileDomains(domains);
    if (!name || desiredDomains.length === 0 || typeof wrangler !== "function") {
        throw new Error("Turnstile widget name, hostnames, and Wrangler runner are required");
    }
    const widgets = parseWranglerJson(
        wrangler(["turnstile", "widget", "list", "--json"], { capture: true }),
        "list Turnstile widgets",
    );
    let siteKey = Array.isArray(widgets)
        ? widgets.find((widget) => widget.name === name)?.sitekey
        : null;

    if (!siteKey) {
        const created = parseWranglerJson(wrangler([
            "turnstile", "widget", "create", name,
            ...desiredDomains.flatMap((domain) => ["--domain", domain]),
            "--mode", "managed", "--json",
        ], { capture: true }), "create the Turnstile widget");
        siteKey = created.sitekey;
    } else {
        const current = parseWranglerJson(
            wrangler(["turnstile", "widget", "get", siteKey, "--json"], { capture: true }),
            "read the Turnstile widget",
        );
        const mergedDomains = normalizeTurnstileDomains([
            ...(current.domains || []),
            ...desiredDomains,
        ]);
        if (mergedDomains.length !== normalizeTurnstileDomains(current.domains).length) {
            wrangler([
                "turnstile", "widget", "update", siteKey,
                ...mergedDomains.flatMap((domain) => ["--domain", domain]),
                "--mode", current.mode || "managed", "--json",
            ], { capture: true });
        }
    }

    if (!siteKey) {
        throw new Error("Wrangler did not return a Turnstile site key");
    }
    const widget = parseWranglerJson(
        wrangler(["turnstile", "widget", "get", siteKey, "--json"], { capture: true }),
        "read the Turnstile secret",
    );
    if (!widget.sitekey || !widget.secret) {
        throw new Error("Wrangler did not return the Turnstile site key and secret key");
    }
    return { siteKey: widget.sitekey, secretKey: widget.secret };
}
