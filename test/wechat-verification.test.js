import assert from "node:assert/strict";
import test from "node:test";
import { createWechatVerificationService } from "../src/wechat-verification-service.js";

function fixture() {
    const values = new Map();
    const service = createWechatVerificationService({
        async get(key) { return values.get(key) ?? null; },
        async set(key, value) { values.set(key, value); },
    });
    return { service, values };
}
const admin = { role: "admin" };
const example = {
    filename: "eae2ede6b2d6096f616091c19cd448a8.txt",
    content: "0127c3a1f08c70701ca480b1c366b225d885917a",
};

test("verification settings default to disabled and persist a single atomic pair", async () => {
    const { service, values } = fixture();
    assert.deepEqual(await service.get(admin), { filename: "", content: "" });
    assert.deepEqual(await service.update(admin, example), example);
    assert.equal(values.size, 1);
    assert.deepEqual(await service.get(admin), example);
    const exact = { ...example, content: "  token\r\n第二行\n " };
    await service.update(admin, exact);
    const response = await service.serve(new Request(`https://example.com/${example.filename}`));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), exact.content);
    assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("verification updates, renames and clearing take effect without stale content", async () => {
    const { service } = fixture();
    const request = (name, method = "GET") => new Request(`https://example.com/${name}`, { method });
    assert.equal(await service.serve(request(example.filename)), null);
    await service.update(admin, example);
    assert.equal(await (await service.serve(request(example.filename))).text(), example.content);
    assert.equal(await (await service.serve(request(example.filename, "HEAD"))).text(), "");
    assert.equal((await service.serve(request(example.filename, "POST"))).status, 405);
    assert.equal(await service.serve(request(`nested/${example.filename}`)), null);
    await service.update(admin, { filename: "new.txt", content: "replacement" });
    assert.equal(await service.serve(request(example.filename)), null);
    assert.equal(await (await service.serve(request("new.txt"))).text(), "replacement");
    await service.update(admin, { filename: "", content: "" });
    assert.equal(await service.serve(request("new.txt")), null);
});

test("only administrators can manage verification settings", async () => {
    const { service, values } = fixture();
    for (const user of [null, { role: "user" }]) {
        await assert.rejects(service.get(user), /administrator/i);
        await assert.rejects(service.update(user, example), /administrator/i);
    }
    assert.equal(values.size, 0);
});

test("verification rejects unsafe names, incomplete pairs and oversized or non-text content", async () => {
    const { service, values } = fixture();
    for (const filename of ["../a.txt", "a/b.txt", "a\\b.txt", "/a.txt", ".txt", "a.txt?x", "a%2ftxt", "index.html", "a.txt\n", " a.txt", "a".repeat(129) + ".txt", "robots.txt"]) {
        await assert.rejects(service.update(admin, { ...example, filename }), { code: "invalid_wechat_verification" });
    }
    for (const input of [null, {}, { ...example, filename: "" }, { ...example, content: "" }, { ...example, content: 5 }, { ...example, content: "x".repeat(4097) }]) {
        await assert.rejects(service.update(admin, input), { code: "invalid_wechat_verification" });
    }
    assert.equal(values.size, 0);
});
