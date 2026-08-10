import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("English and Chinese guides cover every supported deployment path", async () => {
    const [english, chinese] = await Promise.all([
        readFile(new URL("../README.md", import.meta.url), "utf8"),
        readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8"),
    ]);
    for (const guide of [english, chinese]) {
        assert.match(guide, /deploy\.workers\.cloudflare\.com/);
        assert.match(guide, /deploy\.sh/);
        assert.match(guide, /CLOUDFLARE_API_TOKEN/);
        assert.match(guide, /CLOUDFLARE_ACCOUNT_ID/);
        assert.match(guide, /91/);
        assert.match(guide, /\/pub\/[0-9a-f]/);
        assert.doesNotMatch(guide, /\/(?:file|text)\/pub_/);
        assert.match(guide, /\?v=/);
        assert.match(guide, /IMG_HUB_API_KEY/);
        assert.match(guide, /IMG_HUB_URL/);
        assert.match(guide, /Chrome.*Edge.*Firefox/s);
        assert.match(guide, /0\.0\.0-dev/);
        assert.match(guide, /img-hub-extension-chrome/);
        assert.match(guide, /img-hub-extension-edge/);
        assert.match(guide, /img-hub-extension-firefox/);
        assert.match(guide, /CHROME_REFRESH_TOKEN/);
        assert.match(guide, /WEB_EXT_API_SECRET/);
        assert.match(guide, /Template|模板/i);
        assert.match(guide, /npm run test:local/);
        assert.match(guide, /npm run dev:local/);
        assert.match(guide, /npm run local:reset/);
        assert.match(guide, /http:\/\/localhost:8787/);
        assert.match(guide, /caches\.default/);
        assert.match(guide, /site title|站点标题/i);
        assert.match(guide, /admin:reset/);
        assert.match(guide, /Reset administrator password|重置管理员密码/);
        assert.match(guide, /IMG_HUB_ADMIN_RESET_PASSWORD/);
        assert.match(guide, /no default password|没有默认密码/i);
        assert.match(guide, /browser language|浏览器语言/i);
        assert.match(guide, /content audit|内容审计/i);
        assert.match(guide, /disable account|禁用账户/i);
        assert.match(guide, /Administration|管理/);
        assert.match(guide, /fixed administrator username|管理员用户名固定/i);
        assert.match(guide, /Turnstile/);
        assert.match(guide, /Turnstile Sites Write/);
        assert.match(guide, /IMG_HUB_TURNSTILE_DOMAINS/);
        assert.match(guide, /IMG_HUB_WECHAT_VERIFY_FILENAME/);
        assert.match(guide, /IMG_HUB_WECHAT_VERIFY_CONTENT/);
        assert.match(guide, /root|根路径/i);
        assert.match(guide, /three failed|3 次失败|三次失败/i);
        assert.match(guide, /Create Custom Token|创建自定义令牌/);
        assert.match(guide, /#cloudflare-token/);
        for (const permission of [
            "Account Settings Read",
            "Workers Scripts Edit",
            "D1 Edit",
            "Workers R2 Storage Edit",
            "Turnstile Edit",
            "User Details Read",
            "Memberships Read",
        ]) {
            assert.match(guide, new RegExp(permission));
        }
    }
});

test("GitHub Pages publishes bilingual deployment documentation", async () => {
    const [workflow, english, chinese] = await Promise.all([
        readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
        readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
        readFile(new URL("../docs/zh-CN.html", import.meta.url), "utf8"),
    ]);
    assert.match(workflow, /actions\/deploy-pages/);
    assert.match(workflow, /actions\/upload-pages-artifact/);
    assert.match(english, /One-click deployment/i);
    assert.match(chinese, /一键部署/);
    for (const guide of [english, chinese]) {
        assert.match(guide, /IMG_HUB_API_KEY/);
        assert.match(guide, /Chrome.*Edge.*Firefox/s);
        assert.match(guide, /GitHub Release/);
        assert.match(guide, /test:local/);
        assert.match(guide, /local:reset/);
        assert.match(guide, /http:\/\/localhost:8787/);
        assert.match(guide, /caches\.default/);
        assert.match(guide, /admin:reset/);
        assert.match(guide, /Reset administrator password|重置管理员密码/);
        assert.match(guide, /IMG_HUB_ADMIN_RESET_PASSWORD/);
        assert.match(guide, /no default password|没有默认密码/i);
        assert.match(guide, /browser language|浏览器语言/i);
        assert.match(guide, /content audit|内容审计/i);
        assert.match(guide, /disable account|禁用账户/i);
        assert.match(guide, /Turnstile/);
        assert.match(guide, /Turnstile Sites Write/);
        assert.match(guide, /IMG_HUB_WECHAT_VERIFY_FILENAME/);
        assert.match(guide, /IMG_HUB_WECHAT_VERIFY_CONTENT/);
        assert.match(guide, /three failed|3 次失败|三次失败/i);
    }
});

test("GitHub Pages visually documents the least-privilege Cloudflare deployment token", async () => {
    const assetNames = [
        "cloudflare-token-create.svg",
        "cloudflare-token-permissions.svg",
        "cloudflare-token-scope.svg",
    ];
    const [english, chinese, ...screenshots] = await Promise.all([
        readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
        readFile(new URL("../docs/zh-CN.html", import.meta.url), "utf8"),
        ...assetNames.map((name) => readFile(new URL(`../docs/assets/${name}`, import.meta.url), "utf8")),
    ]);

    for (const [guide, customTokenLabel] of [
        [english, "Create Custom Token"],
        [chinese, "创建自定义令牌"],
    ]) {
        assert.match(guide, /id="cloudflare-token"/);
        assert.match(guide, new RegExp(customTokenLabel));
        for (const assetName of assetNames) {
            assert.match(guide, new RegExp(`<img[^>]+src="assets/${assetName}"[^>]+alt="[^"]+"`));
        }
        for (const permission of [
            "Account Settings Read",
            "Workers Scripts Edit",
            "D1 Edit",
            "Workers R2 Storage Edit",
            "Turnstile Edit",
            "User Details Read",
            "Memberships Read",
        ]) {
            assert.match(guide, new RegExp(permission));
        }
        assert.match(guide, /Include.*Specific account|Include.*指定账号/s);
        assert.match(guide, /Global API Key/);
    }
    for (const screenshot of screenshots) {
        assert.match(screenshot, /<title>[^<]+<\/title>/);
        assert.doesNotMatch(screenshot, /cfut_|CLOUDFLARE_API_TOKEN\s*=/);
    }
});
