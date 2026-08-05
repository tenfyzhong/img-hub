import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contributor guides document development, tests, and manual verification in both languages", async () => {
    const [english, chinese, pullRequestTemplate, agentGuide] = await Promise.all([
        readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8"),
        readFile(new URL("../CONTRIBUTING.zh-CN.md", import.meta.url), "utf8"),
        readFile(new URL("../.github/pull_request_template.md", import.meta.url), "utf8"),
        readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
    ]);

    for (const guide of [english, chinese]) {
        assert.match(guide, /Node\.js 22/);
        assert.match(guide, /npm ci/);
        assert.match(guide, /npm test/);
        assert.match(guide, /npm run test:local/);
        assert.match(guide, /npm run dev:local/);
        assert.match(guide, /npm run local:reset/);
        assert.match(guide, /http:\/\/localhost:8787/);
        assert.match(guide, /npm run build:extension/);
        assert.match(guide, /npm run check:deploy/);
        assert.match(guide, /git commit -s/);
        assert.match(guide, /R2.*lifecycle|R2.*生命周期/is);
        assert.match(guide, /develop/);
        assert.match(guide, /feature\/\*/);
        assert.match(guide, /release\/\*/);
        assert.match(guide, /hotfix\/\*/);
        assert.match(guide, /Sync fork/);
        assert.match(guide, /template|模板/i);
        assert.match(guide, /admin:reset/);
        assert.match(guide, /language|语言/i);
        assert.match(guide, /content audit|内容审计/i);
        assert.match(guide, /disable account|禁用账户/i);
        assert.match(guide, /Turnstile/);
        assert.match(guide, /three failed|3 次失败|三次失败/i);
    }
    assert.match(pullRequestTemplate, /CONTRIBUTING\.md/);
    assert.match(pullRequestTemplate, /npm run test:local/);
    assert.match(pullRequestTemplate, /manual|手工/i);
    assert.match(pullRequestTemplate, /target.*develop|目标.*develop/i);

    assert.match(agentGuide, /npm run test:local/);
    assert.match(agentGuide, /\.git\/wtm/);
    assert.match(agentGuide, /users\/\{user-id\}\/file/);
    assert.match(agentGuide, /users\/\{user-id\}\/text/);
    assert.match(agentGuide, /IMG_HUB_API_KEY/);
    assert.match(agentGuide, /develop/);
    assert.match(agentGuide, /git commit -s/);
    assert.match(agentGuide, /resource_moderation/);
    assert.match(agentGuide, /login_challenges/);
    assert.match(agentGuide, /Turnstile/);
});
