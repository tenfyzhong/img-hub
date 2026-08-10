# ImgHub

[English](README.md) · [在线部署指引](https://tenfyzhong.github.io/img-hub/zh-CN.html) · [贡献指南](CONTRIBUTING.zh-CN.md)

ImgHub 是一个只使用 Cloudflare Workers、D1 和 R2 的多用户文件与文本托管服务。用户登录后只能管理自己的内容；替换内容时公开路径不变，只更新 `?v=` 版本参数，让浏览器和 CDN 获取新内容。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tenfyzhong/img-hub)

## 功能

- 首次启动时创建管理员，不使用共享上传认证码。
- 管理员可创建用户、分配临时密码和重置密码。
- 用户首次使用分配或重置后的密码登录时，必须先修改密码。
- 15 分钟内登录密码连续 3 次失败后，浏览器要求完成 Cloudflare Turnstile；Worker 验证通过后才会接受下一次密码尝试。
- 所有设置密码表单都要求确认密码并支持显示/隐藏；管理员可以一键生成并复制强随机临时密码。
- D1 中每条文件和文本记录都包含创建者；用户只能列出、替换和删除自己的内容。
- R2 按用户 ID 隔离根目录：`users/{user-id}/file/` 与 `users/{user-id}/text/`。
- 文件与文本统一使用 `/pub/7b62…` 形式的随机公开路径，不暴露资源类型、用户名、目录或文件名。不支持以前的根路径、`/file/`、`/text/`、带 `pub_` 前缀的 ID 和带用户名的公开路径。
- 替换内容不改变随机公开路径和 R2 object key，只递增缓存版本，例如 `/pub/7b62…?v=2`。
- **上传** 菜单用占满一行的三个等高页签提供上传文件、发布文本和文件外链；独立的 **文件管理** 菜单在同一个目录树和资源库中混合管理文件与文本，不再按类型切换。
- 选择文件、拖入文件，或粘贴文件和剪贴板图片后会立即上传并显示进度；上传结果和历史文件均可一键复制裸 URL、Markdown 或 HTML。
- 新文件和文本名称会加入毫秒级 UTC 时间戳，因此相同原始名称可以重复发布。文本文件名选填，留空时按格式自动生成；文本发布结果与文件上传一样提供 URL、Markdown 和 HTML 复制按钮。
- 浏览器上传文件前会分块计算 MD5；仅当同一用户自己的同大小文件命中时，才跳过客户端上传并把已有 R2 对象复制成相互独立的新资源，不会跨用户匹配哈希。
- 文件管理支持目录树筛选、网格/列表视图；支持在经过私网地址与大小检查后抓取图片、文档、压缩包、音视频、文本及其他 HTTP(S) 文件外链，并实时显示抓取字节进度和保存到存储的阶段。
- 发布文本界面提供 Markdown 和受限富文本编辑；文件管理会直接预览文本，并把超大或过长图片限制在卡片内部；上传、外链导入、替换与删除操作保存在 D1 时间轴中。
- 管理员可在网页中设置 R2 保留天数。部署后的 Worker 默认保留 91 天，并通过每日定时维护任务删除到期对象，不保存 Cloudflare 管理凭据。
- 用户可以创建带名称、有效期且可撤销的 API Key；系统只保存 Key 的哈希，明文仅显示一次。
- 内置 Agent Skill 可通过 API Key 管理资源；浏览器插件支持配置任意部署域名，并支持 Chrome、Edge、Firefox。
- 带正确版本号的 `/pub/{随机 ID}` 读取使用 `caches.default`；通过轻量 D1 审计检查后，缓存命中会跳过 R2 object 读取。
- 管理员可以配置站点标题、标语、欢迎标题与欢迎说明。
- 不包含其他存储通道，仅使用 Cloudflare R2。

## 部署方式一：Cloudflare 一键部署按钮

点击上方按钮，授权 Cloudflare，保留自动识别的 `npm run deploy` 命令并部署仓库。同一条部署命令会初始化 D1/R2、应用唯一的初始 D1 schema、为生成的域名创建或复用 managed Turnstile Widget、把私钥保存为 Worker Secret，然后部署带每日保留任务的 ImgHub。除了 Worker/D1/R2 权限，Turnstile 自动配置还需要 **Turnstile Sites Write**。

部署后：

1. 打开生成的 `workers.dev` 地址。
2. 为固定管理员用户名 `admin` 设置密码；管理员创建成功后，初始化接口永久关闭。
3. 创建用户，并通过安全渠道分发临时密码。管理员可在 **站点设置** 中修改默认 91 天的保留时间；网站不会要求填写 Cloudflare Account ID、bucket 名称或 API Token。

自动资源创建是 Wrangler 当前提供的能力。如果你的 Cloudflare 账号或部署入口不支持，请使用下面的命令行一键部署。

## 部署方式二：命令行一键部署

要求安装 Node.js 22 或更高版本，并准备一个 Cloudflare 账号。

```sh
git clone https://github.com/tenfyzhong/img-hub.git
cd img-hub
./deploy.sh
```

脚本会通过 Wrangler 登录，并以幂等方式完成：

1. 创建或复用 D1 数据库 `img-hub-db`。
2. 创建或复用 R2 bucket `img-hub-files`。
3. 生成不纳入 Git 的 binding 配置并应用唯一的初始 D1 schema。
4. 创建或复用 managed Turnstile Widget，并安全写入其 Secret。
5. 部署 Worker、静态网站和每日 R2 保留任务。

脚本不会删除数据库或 bucket。可按需自定义名称和区域：

```sh
IMG_HUB_DATABASE_NAME=my-hub-db \
IMG_HUB_BUCKET_NAME=my-hub-files \
IMG_HUB_D1_LOCATION=apac \
IMG_HUB_R2_LOCATION=apac \
IMG_HUB_TURNSTILE_DOMAINS=images.example.com \
IMG_HUB_WECHAT_VERIFY_FILENAME=30192898bf0120ae25f69bdce9e25e77.txt \
IMG_HUB_WECHAT_VERIFY_CONTENT=verification-content-from-wechat \
./deploy.sh
```

D1/R2 可用区域由 Wrangler 决定；不设置区域变量时由 Cloudflare 自动选择。脚本会自动识别生成的 `workers.dev` 域名；只有需要授权额外自定义域名时，才设置逗号分隔的 `IMG_HUB_TURNSTILE_DOMAINS`。一个 Widget 最多支持 10 个域名条目，并自动覆盖所配域名的子域名。两个可选的微信验证变量必须一起提供；部署会把内容原样发布到根路径 `/{文件名}`，不会修改仓库中的 `public/` 目录。

## 部署方式三：GitHub Actions

仓库只保留职责明确的工作流：无 Secret 的 CI、稳定 Cloudflare 部署、Tag Release、浏览器插件包、GitHub Pages 文档和手动管理员找回。

1. 需要使用 **Sync fork** 持续更新时请选择 Fork；需要独立仓库时可从模板创建。仓库维护者需先在 **Settings → General → Template repository** 开启一次模板选项，GitHub 才会显示 **Use this template**。
2. 按照带截图的 [Cloudflare 最小权限 Token 指引](https://tenfy.cn/img-hub/zh-CN.html#cloudflare-token)，选择 **创建自定义令牌（Create Custom Token）**，不要使用 Global API Key 或宽泛的内置模板。登录验证自动配置需要 **Turnstile Sites Write**。
3. 打开 GitHub 仓库的 **Settings → Secrets and variables → Actions**，添加：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. 如果微信提供了站点验证文本文件，切换到 **Variables** 页签，并同时添加两个 Repository Variables：
   - `IMG_HUB_WECHAT_VERIFY_FILENAME`：微信给出的文件名，例如 `30192898bf0120ae25f69bdce9e25e77.txt`
   - `IMG_HUB_WECHAT_VERIFY_CONTENT`：微信给出的完整文件内容
5. 打开 **Actions → Deploy to Cloudflare → Run workflow**，或向 `main` 分支推送提交。

微信站点验证是可选配置。必须两个变量都配置或都不配置；只配置一项或文件名不安全时，脚本会在改动 Cloudflare 资源之前失败。文件名只能是根路径下的 `.txt` 文件，由字母、数字、`_`、`-` 组成，不能包含目录或空格。部署时会复制静态站点到隔离的临时目录，不额外添加换行地写入内容，发布到类似 `https://images.example.com/30192898bf0120ae25f69bdce9e25e77.txt` 的地址，最后删除临时副本。验证内容部署后本来就会公开，因此应放在 Repository Variable 中，而不要提交进源码。使用 Tag 部署时，`release.yml` 会读取同样的变量。

自定义 Token 应包含且只包含：**Account Settings Read**、**Workers Scripts Edit**、**D1 Edit**、**Workers R2 Storage Edit**、**Turnstile Edit**、**User Details Read** 和 **Memberships Read**。在 **Account Resources** 中把范围限制为 **Include → 指定账号（Specific account）**。默认 `workers.dev` 部署不需要 KV、Tail、DNS 或 Zone 权限；只有以后给特定 Zone 配置 Route 时才增加 **Workers Routes Edit**。

`main` 是稳定分发分支，开发代码通过 `develop` 集成。同一份部署 workflow 同时适用于本仓库和所有 fork。GitHub 只读取当前运行仓库自己的 Secrets 和 Variables，因此 fork 只会部署到 fork 所有者自己的 Cloudflare 账号，也只会发布该 fork 配置的验证文件。默认资源前缀是 `img-hub-{repository-id}`，避免本仓库与不同 fork 的 Worker、D1、R2、Turnstile 重名。可添加 Actions Repository Variable `IMG_HUB_RESOURCE_PREFIX` 自定义前缀；CLI 还支持 `IMG_HUB_WORKER_NAME`、`IMG_HUB_DATABASE_NAME`、`IMG_HUB_BUCKET_NAME`、`IMG_HUB_TURNSTILE_DOMAINS`、`IMG_HUB_WECHAT_VERIFY_FILENAME` 和 `IMG_HUB_WECHAT_VERIFY_CONTENT`。

不读取 Secret 的 CI 会验证目标为 `develop` 和 `main` 的 PR；稳定部署 workflow 会验证每次 `main` 更新，再运行 `npm run deploy:cloudflare`，自动创建 D1/R2/Turnstile、应用初始 D1 schema，并带每日保留任务和 Turnstile Secret 部署 Worker。Fork 用户必须先启用一次 Actions，同步后的 `main` 才会自动构建。没有配置两个 Cloudflare Secrets 时验证仍会执行，部署步骤会明确跳过。完整分支与发布规则见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。模板创建的仓库历史独立，没有 GitHub 的 **Sync fork** 路径。

### 销毁 Cloudflare 部署

> **危险——这是毁灭性且不可恢复的操作。** 仅用于可随时丢弃的测试部署。它会永久删除对应 Worker、R2 bucket 中的全部 object 及 bucket 本身、D1 数据库和托管的 Turnstile Widget；操作不会创建备份，数据删除后无法找回。

在 `main` 上打开 **Actions → DESTRUCTIVE: Destroy Cloudflare deployment → Run workflow**。依次输入仓库准确的 `owner/repository`、`DESTROY owner/repository`，并勾选永久数据丢失确认。分支不是 `main`、任一文本不完全匹配、没有勾选警告或缺少 Cloudflare Secrets 时，workflow 都会拒绝执行。它与 `deploy.yml` 使用相同的仓库专属 `IMG_HUB_RESOURCE_PREFIX`，因此原仓库和每个 fork 只会定位各自命名的部署。

Workflow 先删除 Worker 以停止新写入，再清空并删除 R2，然后删除 D1，最后删除 Turnstile。Bucket Lock 会阻止 object 删除；只有再次确认目标后才能移除 Lock 并重新运行。它不会删除这个命名部署之外的 DNS 记录、手工创建的 Worker Route 或其他 Cloudflare 资源，也不会影响本地 `.wrangler/state/`；清理可丢弃的本地数据请使用 `npm run local:reset`。

### 开启指引网站

进入 GitHub 仓库的 **Settings → Pages**，将 Source 设置为 **GitHub Actions**。`pages.yml` 会把 `docs/` 下的中英文指引发布为 GitHub Pages。

## API Key 与 Agent Skill

用户完成临时密码修改后，打开侧边栏 **安全** 下方独立且全宽的 **API Key** 菜单，填写名称和可选有效期后创建 Key；**安全** 页的修改密码表单同样占满内容行。请立即复制显示一次的 `imh_...`；系统只保存哈希。撤销后下一次请求立即失效。API Key 只能操作所属用户自己的资源，不能管理用户、修改密码或继续创建 Key。

可复用 Skill 位于 `skills/img-hub`。将整个目录复制到 AI Agent 使用的 skills 目录，并在 Agent 进程的环境变量中配置：

```sh
export IMG_HUB_URL=https://images.example.com
export IMG_HUB_API_KEY=imh_your_key_shown_once
```

Skill 自带无第三方依赖的客户端，可列出、上传、替换、删除文件，也可发布或替换文本：

```sh
python3 skills/img-hub/scripts/img_hub.py upload ./diagram.png --directory agents
python3 skills/img-hub/scripts/img_hub.py list --kind file
```

不要把 `IMG_HUB_API_KEY` 写进 prompt、shell history、日志或代码仓库。

## 浏览器插件

从 GitHub Release 下载三个独立产物：

- `img-hub-extension-chrome-*.zip`：用于 Chrome
- `img-hub-extension-edge-*.zip`：用于 Microsoft Edge
- `img-hub-extension-firefox-*.zip`：用于 Firefox

本地安装时先解压对应包。Chrome/Edge 在扩展管理页开启 **Developer mode** 后选择 **Load unpacked**；Firefox 打开 `about:debugging#/runtime/this-firefox` 选择 **Load Temporary Add-on**，或在发布到 AMO 后安装签名包。在同一个登录窗口填写 Deployment URL、用户名和密码后点击 **Sign in**；登录成功会自动保存 URL、用户名与登录 Token，并隐藏整个登录区域，只显示上传工作区。插件绝不保存密码。Token 失效后登录区域会重新出现，之前的 URL 与用户名会自动回填。

工作区与站点一样提供三个发布页签：带用户级秒传检查的文件上传、Markdown/富文本发布，以及从 HTTP(S) 外链导入文件。居中的文件区域支持选择文件、拖入文件、粘贴文件和剪贴板图片，四种方式都会立即开始上传；在输入框或编辑器中粘贴仍按普通文本编辑处理。如果插件失去焦点导致浏览器拒绝自动复制 URL，发布仍会保持成功，并可从最近上传中再次复制。列表统一显示最近创建的 10 条文件或文本；点击 **打开 ImgHub** 可直接打开当前 Deployment URL。插件默认跟随浏览器第一首选语言，也可以通过 **EN / 中文** 手动切换并持久保存，与主站共用英文和简体中文目录。固定尺寸的选择区域不会因为文件反馈而改变插件弹窗宽度。插件会直接以固定的 780 像素双栏布局打开，发布区域位于左侧，最近上传记录位于右侧；不会先显示窄版上下布局再扩大窗口。

运行 `npm run build:extension` 可在 `dist/extensions/chrome/`、`dist/extensions/edge/` 和 `dist/extensions/firefox/` 生成三个可直接调试的目录及 ZIP；开发产物显示版本 `0.0.0-dev`。也可分别运行 `npm run build:extension:chrome`、`npm run build:extension:edge` 或 `npm run build:extension:firefox`。产物不包含固定部署域名，因此同一套插件可连接本仓库或任意 fork 部署的服务。

## 版本发布与浏览器商店

先把主应用 `package.json` 更新为发布版本并提交，再推送匹配 Tag，例如 `v0.3.0`。插件源码的开发版本始终为 `0.0.0-dev`；`release.yml` 会从 Tag 得出正式插件版本，运行测试并分别打包 Chrome、Edge、Firefox。若当前仓库配置了 Cloudflare 凭据，会部署 Tag 版本；随后创建包含三个 ZIP 的 GitHub Release。

只有配置了完整 Actions Secrets 集合时，才自动发布对应浏览器商店：

- Chrome：`CHROME_PUBLISHER_ID`、`CHROME_EXTENSION_ID`、`CHROME_CLIENT_ID`、`CHROME_CLIENT_SECRET`、`CHROME_REFRESH_TOKEN`
- Edge：`EDGE_PRODUCT_ID`、`EDGE_CLIENT_ID`、`EDGE_API_KEY`
- Firefox：`WEB_EXT_API_KEY`、`WEB_EXT_API_SECRET`

某个商店缺少 Secret 时只跳过该商店，不影响插件打包或其他商店。首次使用 API 自动发布前，需要先在各浏览器开发者后台创建对应的商店条目。

## 首次启动与账号流程

系统没有默认管理员密码。管理员用户名固定为 `admin`；全新部署第一次打开时，访问者需要在管理员初始化表单中设置并确认密码。完成后：

1. 管理员登录并为用户创建临时密码。
2. 用户可使用临时密码登录，但所有文件和文本操作都会被阻止。
3. 用户修改临时密码后才能正常使用。
4. 管理员重置密码会撤销该用户所有会话；用户主动改密后只保留当前会话。

密码使用带随机盐的 PBKDF2-SHA-256 保存。浏览器访问 Session 有效期为 7 天，轮换式 refresh Session 有效期为 30 天。访问 Session 过期时，网页会使用 `HttpOnly` refresh Cookie 换取新的 7 天/30 天凭据组合，并立即废弃旧 refresh token；持续使用可以延长登录态，连续 30 天没有刷新则必须重新输入密码。两个 Cookie 都使用 `SameSite=Strict`，HTTPS 下启用 `Secure`；D1 只保存 token 哈希。

相同规范化用户名和 Cloudflare 客户端 IP 在 15 分钟内连续 3 次失败后，页面会按需显示 Turnstile。D1 的计数表只保存两者组合的 SHA-256 标识，不保存明文用户名或 IP。Turnstile Token 五分钟过期且只能使用一次；服务端会校验 `login` action 和当前主机名。成功登录会清除失败状态。如果浏览器插件触发限制，请先在其配置的 ImgHub 网站完成一次网页登录验证，再回到插件重试。

## 语言

网页首次使用时读取浏览器语言列表中的第一首选语言。以 `zh` 开头的浏览器语言环境使用简体中文，其他语言环境使用英文。页面顶部的 **EN / 中文** 可覆盖浏览器选择，并只在当前浏览器的 local storage 中保存。

内置导航、表单、动态消息、确认框、日期、空状态和常见 API 错误均支持中英文。管理员配置的站点标题和欢迎文案由两种语言共享；未保存自定义配置时，内置欢迎文案分别提供中英文版本。

## 管理员密码找回

ImgHub 没有默认密码、邮件找回、密保问题或后门。唯一管理员忘记密码时，必须由拥有部署控制权的人通过仓库内置的 D1 恢复工具重置。

恢复本地持久化开发数据库时，先停止 `npm run dev:local`，再执行：

```sh
npm run admin:reset
npm run dev:local
```

恢复已部署数据库时，先登录 Wrangler，在 Cloudflare Dashboard 或通过 `npx wrangler d1 list` 找到准确的 D1 数据库名称，再显式指定：

```sh
npx wrangler login
npm run admin:reset -- --remote --database YOUR_D1_DATABASE_NAME
```

输入新临时密码时终端不会回显。请确认命令输出中的 `administrators_reset` 为 `1`，且 `administrator_username` 为 `admin`；如果前者是 `0`，说明选中的数据库中没有管理员。恢复操作只替换管理员密码哈希，将其标记为临时密码，同时删除管理员全部 Session，并撤销所有有效的管理员 API Key。旧版管理员用户名会被安全地规范为 `admin`，原用户名仅作为公开 URL 别名保留。随后使用用户名 `admin` 和临时密码登录，并立即设置一个不同的正式密码。

远程恢复会直接修改 D1，无法通过应用撤销。请反复确认数据库名称，并且只使用有权操作该部署的凭据。不要把临时密码放进命令行参数、GitHub Actions 输入、日志或代码仓库。

### GitHub Actions：重置管理员密码

手动触发的 **Reset administrator password** workflow 可以执行相同的远程 D1 恢复，并且不会把临时密码暴露为 workflow 输入：

1. 打开 **Settings → Secrets and variables → Actions**，创建或更新 Repository Secret `IMG_HUB_ADMIN_RESET_PASSWORD`，值为 10–256 个字符的新临时密码。继续保留部署使用的 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`；Token 必须具备 D1 Edit 权限。
2. 打开 **Actions → Reset administrator password → Run workflow**，填写已部署 D1 的准确数据库名称，并勾选重置确认框。
3. 确认日志中的 `administrators_reset` 为 `1`，然后使用用户名 `admin` 和临时密码登录，并立即设置一个不同的正式密码。
4. 重置成功后，从仓库中删除 `IMG_HUB_ADMIN_RESET_PASSWORD` Secret。

该 workflow 只能手动触发。它会撤销管理员的全部 Session 和 API Key，并强制下次登录修改密码。不要复用旧密码，也不要把临时密码填进数据库名、Actions 输入、Issue 或日志。

## 管理端地址、内容审计与账户控制

系统没有单独的 `/admin` 地址。请打开站点根地址，例如 `http://localhost:8787`，使用用户名 `admin` 登录，随后导航中会出现 **管理**。数据库尚未初始化时，同一个地址会显示设置并确认密码的管理员初始化表单。

如果本地打开后显示登录表单而不是初始化表单，说明 `.wrangler/state/` 中已经存在管理员。需要保留本地文件和账号时，先停止服务，再运行 `npm run admin:reset`。需要删除全部本地测试数据并重新测试首次启动时，先停止服务，运行 `npm run local:reset`，然后执行 `npm run dev:local`。本地重置不会影响已部署数据库。

**内容审计** 与 **用户管理** 是两个独立的管理员菜单。两个列表都由服务端搜索和分页，浏览器不会一次加载全部记录。用户搜索占满页面行，**创建用户** 通过右侧抽屉打开，不再与列表横向并排。内容审计支持按文件名、公开 ID、上传者、目录或类型搜索，并显示链接、类型、上传时间、上传者和审计状态。执行 **禁止访问并删除源文件** 后，系统会永久删除 R2 源对象；即使链接此前已经进入缓存，公开 URL 也会返回 404；该资源会从上传者列表隐藏，同时在 D1 中保留封禁管理员、封禁时间等审计墓碑。

用户列表提供 **禁用账户** 与 **启用账户**。禁用会立即撤销该用户的全部 Session 和 API Key，禁止登录，并停止访问该账户拥有的全部公开链接。重新启用后可以重新登录，但不会恢复旧 Session 或 Key。唯一管理员账户不能被禁用。

## 存储结构与 URL

用户 `alice` 上传到 `trips/2026` 子目录的图片，在 R2 中保存为：

```text
users/{alice-user-id}/file/trips/2026/lake-20260806T040506123.png
```

公开地址为：

```text
/pub/7b62f18c6d304476a5edc8a4de176cb1?v=1
```

文本采用相同结构：

```text
users/{alice-user-id}/text/notes/hello-20260806T040506123.md
/pub/91ac1f75e0c84353bb9eca92c4f828a0?v=1
```

子目录是 R2 的虚拟前缀，`.` 和 `..` 会被拒绝。新名称会在扩展名前加入毫秒级 UTC 时间戳；文本名留空时自动生成带时间戳的 `.md` 或 `.html` 名称。D1 为每条资源映射随机公开 ID，因此 URL 不会泄露内部路径。替换时仍写入原 R2 key，D1 中的 version 加一，公开路径保持不变，只返回新的 `?v=` 参数。删除时移除 R2 object 和资源元数据，但保留操作时间轴事件。

非图片文件以附件方式下载；旧数据或通过 API 创建的纯文本使用 `text/plain`；Markdown 与受限富文本会转换为安全 HTML，并附带仅允许同源管理页预览的严格 Content Security Policy。外链导入或直接上传的 SVG 使用 sandbox 并作为附件下载，避免在应用域名下执行活动内容。

### 公开读取缓存

`/pub/7b62…?v=3` 这类版本正确的 GET 请求会通过 `caches.default` 写入 Cloudflare Cache API。每次请求会先执行一次轻量 D1 可访问性检查，确保已封禁内容和已禁用账户不能利用旧缓存继续展示；检查通过后的缓存命中会跳过 R2 object 读取。首次读取响应包含 `X-ImgHub-Cache: MISS`，缓存命中时为 `HIT`。无效、不存在、已删除、已封禁或已过期的公开资源都会显示本地化的 ImgHub 404 页面，不泄露具体原因。

只有唯一、正整数且与 D1 当前 version 相同的 `v` 才会写入缓存。无版本、版本错误、额外查询参数及 HEAD 请求返回 `X-ImgHub-Cache: BYPASS`，避免攻击者制造无限缓存 key。版本 URL 在共享缓存中保留一年，但浏览器 `max-age=0` 会让每次访问都经过审计检查；替换内容后返回新的版本 URL，通过新缓存 key 获取更新内容，公开路径仍不变。

Cloudflare Cache API 的内容只存在于处理请求的数据中心，不会自动复制到全球所有数据中心。它会减少活跃区域内重复的大型 R2 object 读取与响应传输，同时由 D1 可访问性检查保证审计封禁始终生效。

## 站点外观配置

管理员可进入独立的 **站点设置** 菜单配置站点标题、标语、欢迎标题和欢迎说明。配置保存在 D1，服务端验证长度，前端只通过 `textContent` 渲染，不会作为 HTML 执行。未配置时自动使用内置默认值。

## R2 保留策略

管理员进入 **站点设置**，填写 1 到 3650 之间的整数。配置保存在 D1，默认值为 91。每日运行的 Worker 定时任务通过现有 R2 binding 只列出 `users/` 下的对象并删除到期内容，因此不需要填写 Cloudflare Account ID、bucket 名称、API Token，也不保存运行时管理 Token。

部署时只会移除早期开发版本创建的固定 `img-hub-default-expiration` 规则，其他 bucket lifecycle rule 保持不变，避免旧的 91 天规则覆盖管理员设置的更长时间。

缩短保留天数后，对象可能在下一次维护任务中被永久删除。修改前应备份 D1 和 R2。本地 Wrangler 的 scheduled event 只会操作本地 R2 state，前提是 binding 保持 local。

## 本地开发

启动一个可在浏览器中手工测试的本地服务：

```sh
npm install
npm run dev:local
```

打开 `http://localhost:8787`。如果是全新的本地数据，页面会先要求为管理员 `admin` 设置密码；随后可以直接通过真实浏览器界面手工测试登录、用户管理、图片与文本上传、替换、公开链接、删除、API Key 和站点外观配置。用测试用户名连续登录失败 3 次，确认下一次尝试前显示 Turnstile Widget。按 `Ctrl+C` 停止服务。

`npm run dev:local` 显式使用 `wrangler dev --local`。D1、R2、静态资源和 cache 都在本机运行；`wrangler.jsonc` 中没有 binding 配置 `remote: true`，也不需要 Cloudflare 凭据。命令使用 Cloudflare 官方公开的 always-pass Turnstile 测试密钥，它们不属于任何账号；只有手工触发验证时才会访问公开 Siteverify 端点。本地 D1/R2/cache 数据持久化在已忽略的 `.wrangler/state/`，所以账号和上传内容会在重启后保留。Worker 会在第一次数据请求时自动创建缺少的表。

需要丢弃本地数据、重新测试首次管理员初始化时，先停止开发服务，再执行：

```sh
npm run local:reset
npm run dev:local
```

该命令不会接触已部署的 Cloudflare 资源，只会删除当前仓库的 `.wrangler/state/`。

自动化本地测试可单独执行：

```sh
npm test
npm run test:local
```

`npm test` 使用内存 D1 repository、R2 bucket 和 Cache API double。`npm run test:local` 还会在隔离且不持久化的 Wrangler 运行时中启动完整 Worker，验证初始化、本地 D1、本地 R2、上传、缓存读取和站点配置；两个命令都不会连接生产资源。

只验证部署包而不发布：

```sh
npx wrangler deploy --dry-run
```

## 项目结构

```text
src/                 Worker、认证、D1 repository、R2 service
public/              无框架依赖的浏览器应用
migrations/          唯一的初始 D1 schema
local-tests/         使用本地 D1/R2/cache 的完整 Worker 集成测试
scripts/             资源初始化与部署逻辑
skills/img-hub/      API Key 客户端与可复用 Agent Skill
extension/           Chrome、Edge、Firefox 共用的插件源码和构建脚本
docs/                GitHub Pages 中英文部署指引
.github/workflows/   CI、稳定 Cloudflare 部署、版本发布与文档工作流
```

## 运维说明

- 应用限制每个文件最大 100 MB、每条文本最大 1 MB；Cloudflare 套餐的请求限制可能更低。
- 后端保留任务删除 object 后，D1 元数据可能仍然存在，此时公开 URL 返回 404，所有者可在列表中删除这条失效记录。
- 缩短保留时间前请备份 D1 与 R2。
- 不要提交 `wrangler.generated.json`、`.wrangler/`、API Token 或 Cookie 文件；仓库已忽略这些路径。

## License

MIT
