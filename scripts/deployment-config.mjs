export function resolveResourceNames(environment = {}) {
    const prefix = environment.IMG_HUB_RESOURCE_PREFIX || "img-hub";
    return {
        workerName: environment.IMG_HUB_WORKER_NAME || prefix,
        databaseName: environment.IMG_HUB_DATABASE_NAME || `${prefix}-db`,
        bucketName: environment.IMG_HUB_BUCKET_NAME || `${prefix}-files`,
    };
}

export function createDeploymentConfig({
    databaseId,
    databaseName,
    bucketName,
    workerName = "img-hub",
    turnstileSiteKey,
    assetsDirectory = "./public",
}) {
    if (!databaseId || !databaseName || !bucketName || !workerName) {
        throw new Error("databaseId, databaseName, bucketName, and workerName are required");
    }
    return {
        $schema: "./node_modules/wrangler/config-schema.json",
        name: workerName,
        main: "src/index.js",
        compatibility_date: "2026-08-05",
        d1_databases: [{
            binding: "DB",
            database_name: databaseName,
            database_id: databaseId,
            migrations_dir: "migrations",
        }],
        r2_buckets: [{ binding: "BUCKET", bucket_name: bucketName }],
        ...(turnstileSiteKey ? { vars: { TURNSTILE_SITE_KEY: turnstileSiteKey } } : {}),
        assets: {
            directory: assetsDirectory,
            binding: "ASSETS",
            not_found_handling: "single-page-application",
            run_worker_first: ["/api/*", "/pub/*", "/file/*", "/text/*", "/pub_*"],
        },
        triggers: { crons: ["0 3 * * *"] },
        observability: { enabled: true },
    };
}

export function findDatabaseId(payload, databaseName) {
    const databases = Array.isArray(payload) ? payload : payload?.results;
    if (!Array.isArray(databases)) {
        return null;
    }
    const database = databases.find((candidate) => candidate.name === databaseName);
    return database?.uuid || database?.id || null;
}
