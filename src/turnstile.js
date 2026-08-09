const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;

export async function verifyTurnstileToken({
    token,
    secretKey,
    remoteIp = null,
    expectedAction = "login",
    expectedHostname,
    fetchImpl = fetch,
}) {
    if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) {
        return false;
    }
    if (typeof secretKey !== "string" || !secretKey) {
        return false;
    }

    try {
        const payload = {
            secret: secretKey,
            response: token,
            idempotency_key: crypto.randomUUID(),
        };
        if (remoteIp) payload.remoteip = remoteIp;
        const response = await fetchImpl(SITEVERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!response.ok) return false;
        const result = await response.json();
        return result.success === true
            && result.action === expectedAction
            && result.hostname?.toLowerCase() === expectedHostname?.toLowerCase();
    } catch {
        return false;
    }
}
