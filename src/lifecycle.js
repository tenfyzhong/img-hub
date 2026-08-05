export const MANAGED_LIFECYCLE_RULE_ID = "img-hub-default-expiration";

export function buildLifecycleRules(existingRules, retentionDays) {
    const days = Number(retentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new Error("Retention days must be between 1 and 3650");
    }
    const preserved = Array.isArray(existingRules)
        ? existingRules.filter((rule) => rule?.id !== MANAGED_LIFECYCLE_RULE_ID)
        : [];
    return [...preserved, {
        id: MANAGED_LIFECYCLE_RULE_ID,
        enabled: true,
        conditions: { prefix: "users/" },
        deleteObjectsTransition: {
            condition: { type: "Age", maxAge: days * 86400 },
        },
    }];
}

async function readApiResponse(response) {
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error(`Cloudflare API returned HTTP ${response.status}`);
    }
    if (!response.ok || payload.success === false) {
        const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
        throw new Error(message || `Cloudflare API returned HTTP ${response.status}`);
    }
    return payload;
}

export async function configureLifecycle({
    accountId,
    bucketName,
    apiToken,
    retentionDays,
    fetchImpl = fetch,
}) {
    if (!accountId || !bucketName || !apiToken) {
        throw new Error("Account ID, bucket name, and API token are required");
    }
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/lifecycle`;
    const headers = {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
    };
    const current = await readApiResponse(await fetchImpl(endpoint, { headers }));
    const rules = buildLifecycleRules(current.result?.rules, retentionDays);
    await readApiResponse(await fetchImpl(endpoint, {
        method: "PUT",
        headers,
        body: JSON.stringify({ rules }),
    }));
    return { retentionDays: Number(retentionDays), bucketName };
}
