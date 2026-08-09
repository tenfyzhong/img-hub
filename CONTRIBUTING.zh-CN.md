# 为 ImgHub 贡献代码

[English guide](CONTRIBUTING.md)

感谢你帮助改进 ImgHub。本指南说明开发流程、自动化检查、浏览器手工测试以及 Pull Request 要求。

## 开始之前

- 先搜索已有 Issue 和 Pull Request，避免重复提交。
- 大型功能或行为变更应先创建 Issue，确认设计和范围后再实现。
- 每个 Pull Request 只处理一个明确主题，避免无关重构增加安全与数据隔离逻辑的审查难度。
- 不要在 Issue、测试输出、提交或截图中发布密码、API Key、Cloudflare Token、Cookie、私有部署地址或用户内容。
- 可能暴露凭据或用户数据的漏洞不要创建公开 Issue。在项目提供私密报告渠道之前，请先通过维护者的 GitHub 主页私下联系。

## 环境要求

- Git
- Node.js 22 或更高版本
- Node.js 自带的 npm
- 修改浏览器插件时需要 Chrome、Edge 或 Firefox

日常开发和测试不需要 Cloudflare 账号。Wrangler 会在本地模拟 D1、R2、静态资源和 Cache API。

## 准备开发环境

Fork 仓库，克隆自己的 Fork，并安装 lockfile 中的依赖：

```sh
git clone https://github.com/YOUR-USER/img-hub.git
cd img-hub
git remote add upstream https://github.com/tenfyzhong/img-hub.git
npm ci
npm test
```

保持 Fork 的 `main` 与上游稳定分支一致，不要在 `main` 上放个人改动：

```sh
git fetch upstream --prune
git switch main
git merge --ff-only upstream/main
git push origin main
```

第一次开发时，从上游创建本地 `develop`：

```sh
git switch -c develop --track upstream/develop
```

每次开始改动前，更新 `develop` 并创建短生命周期分支：

```sh
git switch develop
git pull --ff-only upstream develop
git switch -c feature/short-description
```

如果使用 Git worktree，请把它创建在当前仓库的 `.git/wtm/` 目录中：

```sh
git worktree add .git/wtm/short-description -b feature/short-description upstream/develop
```

## 分支与发布流程

ImgHub 使用轻量 Git Flow，让默认分支始终可供 Fork 安全同步和部署：

```text
feature/* ──PR──> develop ──发布 PR──> main ──v* Tag──> GitHub Release
                    │                    │                │
                    └── 仅 CI            └── 部署         └── 部署并打包插件

hotfix/*（基于 main）──PR──> main ──回合并──> develop
upstream/main ──Sync fork──> fork/main ──验证──> Fork 的 Cloudflare
```

| 分支 | 用途 | 生产部署 |
| --- | --- | --- |
| `main` | 稳定、可部署并分发给 Fork 的默认分支 | 每次 Push 或 Fork 同步后，有仓库凭据时部署 |
| `develop` | 下一版本的集成分支 | 永不部署 |
| `feature/*`、`fix/*`、`docs/*` | 基于 `develop` 的短生命周期工作 | 永不部署 |
| `release/*` | 可选的稳定化、版本号和发布说明 | 合入 `main` 后部署 |
| `hotfix/*` | 基于 `main` 的紧急修复 | 合入 `main` 后部署 |
| `v*` Tag | 从 `main` 创建的不可变正式版本 | 幂等发布部署、GitHub Release 和插件发布 |

普通功能、修复、重构和文档 PR 必须以 `develop` 为目标。目标为 `main` 的 PR 只接受 `develop`、`release/*` 或 `hotfix/*` 作为来源，CI 会强制检查。热修复进入 `main` 后，必须回合并到 `develop`。

正式发布流程：

1. 需要稳定化阶段时从 `develop` 创建 `release/vX.Y.Z`，否则可直接使用 `develop`。
2. 更新 `package.json`、中英文文档和发布相关测试。
3. 完成自动化与手工验证。
4. 创建目标为 `main` 的发布 PR 并完成 Review。
5. 合并后从 `main` 创建匹配的签名 `vX.Y.Z` Tag 并推送。
6. 将 `main` 回合并到 `develop`。

Release Workflow 会拒绝版本与 `package.json` 不一致的 Tag，也会拒绝提交不属于 `main` 的 Tag。

### Repository Rulesets

维护者应为两个长期分支创建启用状态的 GitHub Ruleset。`main` 要求必须通过 PR、至少一次审批、CI 的 `verify` 和 `branch-policy` 检查、禁止 Force push、禁止删除；`develop` 要求必须通过 PR、CI 的 `verify` 检查、禁止 Force push、禁止删除。日常操作不应允许管理员绕过。

Ruleset 属于 GitHub 仓库设置，不能仅靠提交 YAML 自动启用。维护者合入本次配置后需要先创建 `develop`，再到 Settings 中配置：

```sh
git switch main
git pull --ff-only origin main
git switch -c develop
git push origin develop
```

### Fork 与模板更新

需要持续跟随上游的 Fork 应先启用一次 GitHub Actions，保持 `main` 没有自定义提交，配置该 Fork 自己的 Cloudflare Secrets 和 Variables，然后使用 **Sync fork → Update branch**。稳定的 `main` 更新会自动验证，并且只使用 Fork 自己的凭据部署。功能开发放在其他分支，并以 Upstream 的 `develop` 为 PR 目标。

通过 **Use this template** 创建的是 Git 历史不相关的独立快照，不是 GitHub Fork，因此没有 **Sync fork** 更新路径。需要自动对齐上游时请选择真正的 Fork；准备独立维护产品时再使用模板。

## 项目结构

```text
src/                 Worker 路由、认证、D1 repository 与 R2 service
public/              由 Workers Assets 提供的浏览器应用
migrations/          唯一的初始 D1 schema
test/                 可复用的 Node.js 单元与契约测试
local-tests/          使用本地 D1/R2/assets/cache 的完整 Worker 测试
extension/            Chrome、Edge、Firefox 共用的浏览器插件
skills/img-hub/       API Key 客户端与 Agent Skill
scripts/              部署、发布、插件和本地工具
docs/                 GitHub Pages 中英文指引
.github/workflows/    测试、部署、Release 与 Pages 自动化
```

## 开发规则

### 使用测试驱动开发

实现功能、修复问题、重构或改变行为时：

1. 使用现有 Node.js 测试框架添加可复用测试。
2. 运行测试，确认它因为预期原因失败。
3. 实现能让测试通过的最小完整改动。
4. 再次运行目标测试，然后运行完整测试集。

仅修改文档或配置时，不必编造一个失败测试；如果存在可机器校验的文档或配置约束，应更新相应契约测试。

### 保持安全和数据隔离

- 所有资源操作都必须检查当前认证用户的所有权。
- R2 object 必须位于 `users/{user-id}/file/` 或 `users/{user-id}/text/`。
- 密码、Session 和 API Key 只保存哈希，不保存明文。
- 连续登录失败 3 次后必须保持 Turnstile 失败关闭并在服务端校验 Token；`login_challenges` 不得保存明文用户名或 IP。
- 浏览器发起的状态变更请求必须保留同源保护。
- 默认开发配置中不得加入远程 D1 或 R2 binding。
- 首个正式版本发布前，所有数据库结构变化都合入 `migrations/0001_initial.sql`，并同步更新运行时 schema 初始化；不要添加增量 migration 文件。
- 替换公开内容时必须保持路径不变，并递增 `?v=` 缓存版本。

### 格式和提交

- 保持现有缩进：JavaScript 使用四个空格，JSON/YAML 使用两个空格。
- 不允许行尾空格。
- 不要提交 `.wrangler/`、生成的部署配置、`dist/`、凭据、Cookie 或本地上传内容。
- 提交应尽量小，并说明行为变更的原因。
- 所有提交都必须遵守 Developer Certificate of Origin 并添加 sign-off：

```sh
git commit -s -m "feat: describe the change"
```

## 自动化测试

运行可复用单元测试和契约测试：

```sh
npm test
```

使用隔离的本地 D1、R2、静态资源和 cache 模拟运行完整 Worker：

```sh
npm run test:local
```

该命令不需要 Cloudflare 凭据，不会连接已部署的 D1/R2，也不会覆盖 `npm run dev:local` 使用的持久化数据。

根据改动范围运行相关检查：

```sh
# 验证 Worker bundle，但不部署
npm run check:deploy

# 构建通用 Chromium 和 Firefox 插件包
npm run build:extension

# 检查依赖漏洞
npm audit --audit-level=moderate
```

不读取 Secret 的 `ci.yml` 会为目标是 `develop` 或 `main` 的 PR 以及对 `develop` 的 Push 运行这些检查。`deploy.yml` 会独立验证每次稳定 `main` 更新，之后才读取当前仓库自己的 Cloudflare 凭据。修改部署脚本或 Workflow 时应通过 `npm run check:deploy`。修改插件时应通过 `npm run build:extension` 以及下文的浏览器手工测试。修改文档时应保持中英文内容一致。

### 销毁 Cloudflare 部署 Workflow

手动销毁 workflow 是毁灭性且不可恢复的操作：它不会创建备份，会删除对应 Worker、全部 R2 object 及 bucket、D1 数据库和托管的 Turnstile Widget。绝不能把它作为常规手工验证运行；应使用 `test/destroy.test.js` 验证改动。真实执行必须得到仓库所有者明确授权，并且只能针对隔离、可丢弃的 Cloudflare 部署。存在 Bucket Lock 时，workflow 必须安全失败，直到获得授权的操作者移除 Lock。

## 手工测试网页应用

启动完整的本地应用：

```sh
npm ci
npm run dev:local
```

打开 `http://localhost:8787`。服务只使用本地 D1、R2、静态资源和 cache binding。按 `Ctrl+C` 停止服务。本地数据保存在 `.wrangler/state/`，所以账号和上传内容会在重启后保留。

需要重新测试首次初始化流程时，先停止服务，再明确清理本地状态：

```sh
npm run local:reset
npm run dev:local
```

`npm run local:reset` 会永久删除当前仓库的本地 D1、R2 和 cache 数据，但不可能删除已部署的 Cloudflare 资源。

### Turnstile 登录测试

`npm run dev:local` 会传入 Cloudflare 官方公开的 always-pass Turnstile 测试密钥。D1、R2、静态资源和 cache 仍全部在本地，不使用 Cloudflare 账号或生产存储。使用可丢弃用户名，在 15 分钟内制造 3 次失败登录。确认第 3 次失败后显示双语验证、没有 Token 时下一次请求不能进入密码校验、完成 Widget 后只允许一次尝试、成功登录会清除失败状态。达到阈值后的每次失败重试都必须使用新 Token。不要把本地测试密钥替换为生产密钥。

### 管理员恢复测试

系统没有默认管理员密码或公开恢复接口，管理员用户名固定为 `admin`。测试恢复时，先创建本地管理员并停止 Wrangler，运行 `npm run admin:reset`，重新启动 `npm run dev:local`，再使用用户名 `admin` 和终端中输入的临时密码登录。确认管理员原有 Session 和 API Key 全部失效，并且在操作内容前，界面要求设置一个不同的正式密码。

远程恢复命令是 `npm run admin:reset -- --remote --database <D1_DATABASE_NAME>`，它会直接修改 D1。日常贡献测试绝不能对共享或生产数据库执行；线上恢复测试必须获得明确授权并使用一次性数据库。

修改 `.github/workflows/reset-admin-password.yml` 后，应通过 `test/admin-recovery.test.js` 验证。不要为了测试 YAML 而触发该 workflow：线上运行会直接修改选中的 D1 数据库、撤销管理员凭据，必须先获得明确授权并使用一次性部署。

### 语言测试

清除 local storage 中的 `img-hub-language`，修改浏览器语言列表中的第一首选语言。确认 `zh` 语言环境打开中文界面，其他语言打开英文界面。然后使用 **EN / 中文** 切换并刷新，确认手工选择会保留。使用两种语言检查初始化、登录、强制改密、上传页的三个页签、统一资源管理、安全、管理、动态消息、错误、确认框和移动端导航。管理员配置的站点外观有意由两种语言共享；未配置时的内置欢迎文案会本地化。

### 内容审计与禁用账户测试

管理界面就在普通站点根地址中，没有单独的 `/admin` 路径。使用管理员账号登录后分别进入独立的 **内容审计** 与 **用户管理** 菜单。确认搜索由服务端过滤、翻页按钮只读取所选页面，清空搜索会恢复完整的分页列表。用另一个测试用户上传可丢弃的文件和文本，确认内容审计能显示上传者和准确公开链接。先打开链接直至缓存命中，再执行封禁，确认链接立即返回 404、上传者列表不再显示该资源，但审计墓碑仍然保留。封禁会永久删除源对象，所以只能使用可丢弃内容测试。

对测试用户执行禁用账户，确认其浏览器 Session 和 API Key 全部失效、不能登录、该账户的所有公开链接返回 404。重新启用后确认可使用密码重新登录，但旧凭据不会恢复；同时确认管理员账户不能被禁用。

涉及用户行为的改动应按以下清单手工检查：

1. 使用全新的本地状态为管理员 `admin` 设置密码，并确认登录后不再出现初始化入口。
2. 管理员打开创建用户抽屉并生成临时密码，确认两个密码框一致、密码自动复制到剪贴板，成功 Toast 在约 2 秒后消失。再次点击 **复制密码**，确认按钮出现动画、剪贴板内容一致且重新显示 2 秒 Toast，然后创建普通用户。
3. 使用临时密码登录，确认修改密码前不能操作内容。
4. 修改密码并重新登录，在子目录中上传文件和发布文本。
5. 确认文件与文本的公开 URL 都使用 `/pub/{32 位随机 ID}?v=N`，不包含 `pub_` 前缀、资源类型、用户名、目录或文件名，并且替换后随机路径保持不变。打开一个不存在的 `/pub/` URL，确认显示本地化 404 页面。
6. 连续两次打开公开 URL，在浏览器开发者工具中确认首次带版本 GET 返回 `X-ImgHub-Cache: MISS`，重复 GET 可以返回 `HIT`；无版本或错误版本应为 `BYPASS`。
7. 替换文件和文本，确认路径不变、`?v=` 递增，并且新 URL 返回新内容。
8. 删除资源，确认它从所有者列表消失，公开 URL 不再可用。
9. 打开侧边栏 **安全** 下方独立的 **API Key** 菜单，确认卡片占满内容行。创建多个 Key，确认列表只在独立页面向下展开、明文只显示一次；用 Key 执行属于当前用户的请求，然后撤销。
10. 管理员修改站点标题和欢迎文案，确认页面内容与浏览器标题同时更新。
11. 管理员重置普通用户密码，确认已有 Session 和 API Key 失效，并恢复首次修改密码要求。
12. 分别打开独立的 **内容审计** 和 **用户管理** 菜单，确认搜索可以过滤两个列表、清空搜索恢复全部结果；超过 20 条记录时通过上一页/下一页访问，并且当前页面不会无限变长。确认用户搜索占满一行，点击 **创建用户** 时从右侧打开抽屉，关闭后不会在列表旁保留第二列。审计一个文件和一条文本，确认每行显示公开 URL 与上传者。
13. 让一个可丢弃资源进入缓存后将其封禁，确认源对象被删除、公开 URL 返回 404、审计墓碑仍然保留。
14. 禁用并重新启用普通账户，确认 Session/API Key 被撤销，并且禁用期间公开链接不可访问。
15. 确认 **安全** 页的修改密码卡片占满内容行。确认所有设置密码表单会拒绝不一致的确认密码，密码隐藏时显示闭眼、可见时显示睁眼，管理员生成随机密码时两个输入框一致且可复制。
16. 在 **上传发布** 中确认三个页签占满一整行，再依次切换 **上传文件**、**发布文本** 和位于最后的 **文件外链**，确认三个面板随屏幕适配、保持等高且工作区不产生纵向滚动。点击放大的投放区、拖入文件、粘贴复制的文件，再粘贴截图或其他剪贴板图片；确认四种方式都会先计算哈希再上传、显示进度并可复制 URL/Markdown/HTML，且页面没有独立的选择文件按钮。点击 **×** 关闭按钮，确认只有复制结果模块消失，已经发布的资源仍然存在。再次发布后分别切换上传页签和侧栏菜单，确认每次导航都会自动清理结果模块。再次上传同一文件，确认 MD5 检查会跳过客户端上传，同时创建不同的资源记录和 R2 对象。确认所有新名称都包含毫秒级时间戳；无名剪贴板图片会获得安全基础名；在目录或文本编辑器粘贴文字不会误触发上传。
17. 在 **文件管理** 中确认文件与文本混排在一个资源列表中，共用同一个根目录树且没有类型页签；检查目录树筛选、网格/列表、替换和删除。确认发布文本表单只提供 Markdown 与富文本而没有纯文本选项，文件名可以留空，两种编辑框尺寸一致并可读取原文后更新。分别用指定名称和空名称发布文本，确认两者都获得带时间戳的名称并显示 URL/Markdown/HTML 复制按钮。上传超大或过长图片，确认其预览在网格和列表模式下都不会超出卡片；确认 Markdown 和富文本资源会显示沙箱化的卡片内预览。从上传页第三个页签分别导入可丢弃的图片和 PDF、ZIP 等非图片 HTTP(S) 文件：确认有长度响应显示字节百分比，无长度响应显示不确定进度和已抓取字节，随后提示切换到保存存储阶段，非图片安全下载，并且导入记录出现在时间轴。
18. 在浏览器存储工具中确认登录会创建 HttpOnly access 与 refresh Cookie。只删除 `img_hub_session` 后刷新页面，确认 refresh 请求会保持登录并轮换两个 Cookie；删除两个 Cookie 后必须重新输入密码。管理员重置密码和禁用账户也必须让 refresh Session 失效。
19. 为可丢弃用户制造 3 次失败登录，确认中英文界面都会显示 Turnstile；完成验证后正确登录，并确认挑战状态被清除。

不使用浏览器时，可用应用返回的当前公开 URL 查看缓存响应头。必须使用 GET，不要使用 `curl -I`，因为 HEAD 会有意绕过缓存写入：

```sh
curl --silent --show-error --dump-header - --output /dev/null \
  'http://localhost:8787/pub/替换为当前32位随机ID?v=1'
```

### R2 后端保留任务

在 **站点设置** 中确认管理员可保存 1 到 3650 天的整数，刷新后仍保留。部署后的 Worker 默认 91 天，通过现有 R2 binding 每日执行定时清理；浏览器不会要求 Cloudflare Account ID、bucket 名称或 API Token。使用以下命令在不访问 Cloudflare 的情况下验证删除边界：

```sh
node --test test/lifecycle.test.js
```

常规测试不要对已部署 R2 触发保留任务。请使用仓库中的 R2 double 或明确隔离的本地 Wrangler state；只有用户明确授权时才可使用一次性真实数据。

## 手工测试浏览器插件

构建两个插件版本：

```sh
npm run build:extension
```

保持 `npm run dev:local` 运行，并让插件连接 `http://localhost:8787`：

- Chrome 或 Edge：打开扩展管理页面，开启 Developer mode，选择 **Load unpacked**，加载 `dist/extensions/chromium/`。
- Firefox：打开 `about:debugging#/runtime/this-firefox`，选择 **Load Temporary Add-on**，加载 `dist/extensions/firefox/manifest.json`。
- 在插件中配置本地地址，授予 host 权限，并使用测试账号登录。
- 验证上传、刷新列表、复制 URL、替换、删除、退出、错误密码以及本地服务重启后的行为。
- 修改共享弹窗代码或权限时，两个浏览器包都要测试。

`dist/extensions/` 中生成的文件只是测试产物，不应提交。

## 手工测试 Agent Skill

在本地页面创建一次性 API Key，只把它暴露给测试命令进程：

```sh
export IMG_HUB_URL=http://localhost:8787
export IMG_HUB_API_KEY=imh_value_shown_once
python3 skills/img-hub/scripts/img_hub.py list
python3 skills/img-hub/scripts/img_hub.py upload ./example.png --directory contribution-test
```

修改客户端时，应验证列表、上传、替换、删除、发布文本、错误 Key 和已撤销 Key。测试后撤销该 Key，不要把明文写入终端录屏或 Pull Request 日志。

## Pull Request 检查清单

推送前执行：

```sh
npm test
npm run test:local
npm run check:deploy
git diff --check
git status --short
```

涉及插件或 Release 的改动还要执行 `npm run build:extension`。Pull Request 中需要：

- 功能、修复、重构和文档工作以 `develop` 为目标；只有发布或热修复以 `main` 为目标。
- 说明原问题和改动后的行为。
- 存在关联 Issue 时添加链接。
- 列出通过的自动化命令。
- 说明手工测试步骤与结果；不适用时说明原因。
- 只有可见 UI 变化确实需要时才附截图，并先清除账号与用户数据。
- 明确指出 migration、兼容性、缓存、安全和部署影响。
- 确认每个提交都通过 `git commit -s` 包含 `Signed-off-by`。

合并前，维护者可能要求缩小改动范围、增加测试、更新文档或进行干净的 rebase。
