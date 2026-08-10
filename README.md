# ImgHub

[中文说明](README.zh-CN.md) · [Deployment site](https://tenfyzhong.github.io/img-hub/) · [Contributing](CONTRIBUTING.md)

ImgHub is a multi-user file and text hub built only for Cloudflare Workers, D1, and R2. Users sign in to manage their own resources. Public URLs remain stable when content is replaced; the returned `?v=` value changes so browsers and CDNs fetch the new content.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tenfyzhong/img-hub)

## Features

- First-run administrator setup; there is no shared upload code.
- Administrators create users and reset their passwords.
- Assigned and reset passwords must be changed after the user's first login.
- After three failed login attempts within 15 minutes, the browser requires Cloudflare Turnstile. The challenge is validated by the Worker before another password attempt is accepted.
- Every password-setting form requires confirmation and supports show/hide controls. Administrators can generate and copy strong temporary passwords.
- Every D1 resource row records its creator. Users can only list, replace, or delete their own resources.
- Each user has isolated R2 roots: `users/{user-id}/file/` and `users/{user-id}/text/`.
- Files and text share opaque public paths such as `/pub/7b62…`; the resource kind, username, directory, and file name are not exposed. Former root, `/file/`, `/text/`, prefixed `pub_` IDs, and username-based public paths are not supported.
- Replacing content keeps the opaque public path and R2 object key. Only the cache version changes, for example `/pub/7b62…?v=2`.
- The **Upload** workspace has a full-width row of three equal-height tabs for file upload, text publishing, and remote-file import. The separate **Manage** entry presents files and texts together in one directory tree and resource library.
- File selection, drag-and-drop, and pasting files or clipboard images start uploads immediately with progress. Uploaded and historical items can copy raw URL, Markdown, or HTML snippets.
- New file and text names include a millisecond UTC timestamp so the same original name can be published repeatedly. A text name is optional and generated from its format; text results expose the same URL, Markdown, and HTML copy actions as file uploads.
- Before a browser file upload, ImgHub calculates MD5 in chunks. A same-size match owned by the same user skips the client upload and copies the existing R2 object into an independent resource; hashes are never matched across users.
- The file manager provides directory-tree filtering and grid/list views; HTTP(S) URLs for images, documents, archives, audio, video, text, and other files can be fetched after private-network and size checks, with live byte progress followed by the storage-saving stage.
- The publishing UI offers Markdown and a restricted rich-text editor. The manager previews text in-place and contains oversized or unusually tall images within their cards. Upload, import, replacement, and deletion events remain available in a D1-backed timeline.
- Administrators set the R2 retention period in the UI. The deployed Worker defaults to 91 days and removes expired objects in a daily scheduled maintenance run without storing Cloudflare management credentials.
- Users can create named, revocable API keys. Only a hash of each key is stored, and the cleartext value is shown once.
- The bundled Agent Skill uploads and manages resources with an API key; the browser extension supports Chrome, Edge, and Firefox with a configurable deployment URL.
- Versioned `/pub/{opaque-id}` reads use `caches.default`; after a small moderation check in D1, cache hits skip the R2 object read.
- Administrators can customize the site title, tagline, welcome title, and welcome description.
- The application has no third-party storage channels. It uses Cloudflare R2 only.

## Deployment option 1: Cloudflare Deploy button

Click the button above, authorize Cloudflare, keep the detected `npm run deploy` command, and deploy the repository. The shared deployment command provisions D1 and R2, applies the initial D1 schema, creates or reuses a managed Turnstile widget for the generated hostname, stores its secret as a Worker Secret, and deploys ImgHub with its daily retention task. Turnstile configuration requires **Turnstile Sites Write** in addition to the Worker/D1/R2 permissions granted to the build.

After deployment:

1. Open the generated `workers.dev` URL.
2. Set a password for the fixed administrator username `admin`. The setup endpoint is disabled after that account exists.
3. Create user accounts and distribute their temporary passwords securely. The administrator can change the default 91-day retention period under **Site settings**; the website never asks for a Cloudflare Account ID, bucket name, or API token.

Automatic resource provisioning is a current Wrangler feature. If your Cloudflare account or deployment surface does not offer it, use the CLI flow below.

## Deployment option 2: one-command CLI deployment

Requirements: Node.js 22 or newer and a Cloudflare account.

```sh
git clone https://github.com/tenfyzhong/img-hub.git
cd img-hub
./deploy.sh
```

The script signs in through Wrangler, then idempotently:

1. Creates or finds `img-hub-db` in D1.
2. Creates or finds `img-hub-files` in R2.
3. Generates an untracked binding configuration and applies the single initial D1 schema.
4. Creates or reuses a managed Turnstile widget and securely installs its secret.
5. Deploys the Worker, static application, and daily R2 retention task.

The script never deletes a database or bucket. Override names and placement when needed:

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

Valid D1/R2 location values are controlled by Wrangler. Omit placement variables to let Cloudflare choose. The script discovers the generated `workers.dev` hostname automatically; set the comma-separated `IMG_HUB_TURNSTILE_DOMAINS` only to authorize additional custom hostnames. A widget allows its configured hostname and subdomains, and Cloudflare limits each widget to 10 entries. The two optional WeChat variables must be provided together; they publish the exact verification content at `/{filename}` without changing the checked-in `public/` directory.

## Deployment option 3: GitHub Actions

The repository contains focused workflows for secret-free CI, stable Cloudflare deployment, tagged releases, browser packages, GitHub Pages documentation, and manual administrator recovery.

1. Fork the repository when you want **Sync fork** updates, or create an independent repository from this Template repository. The maintainer must enable **Settings → General → Template repository** once for the **Use this template** button to appear.
2. Follow the illustrated [least-privilege Cloudflare token guide](https://tenfy.cn/img-hub/#cloudflare-token): choose **Create Custom Token**, not the Global API Key or a broad built-in template. Automatic login protection requires **Turnstile Sites Write**.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. If WeChat supplied a site-verification text file, open the **Variables** tab and add both repository variables:
   - `IMG_HUB_WECHAT_VERIFY_FILENAME`: the issued file name, for example `30192898bf0120ae25f69bdce9e25e77.txt`
   - `IMG_HUB_WECHAT_VERIFY_CONTENT`: the exact issued file content
5. Open **Actions → Deploy to Cloudflare → Run workflow**, or push to `main`.

WeChat verification is optional. Configure both variables or neither; a partial or unsafe configuration fails before Cloudflare resources are changed. The filename must be a root-level `.txt` name made from letters, numbers, `_`, or `-`, with no directory or spaces. Deployment copies the static application to an isolated temporary directory, writes the content without adding a newline, deploys it at a URL such as `https://images.example.com/30192898bf0120ae25f69bdce9e25e77.txt`, and removes the temporary copy. The verification content becomes public at that URL, so it belongs in a Repository Variable rather than source control. `release.yml` uses the same variables when a tagged release deploys.

The exact custom-token permissions are **Account Settings Read**, **Workers Scripts Edit**, **D1 Edit**, **Workers R2 Storage Edit**, **Turnstile Edit**, **User Details Read**, and **Memberships Read**. Restrict **Account Resources** to **Include → Specific account** for the deployment account. The default `workers.dev` deployment does not need KV, Tail, DNS, or Zone permissions; add **Workers Routes Edit** only when you later configure a route on a specific zone.

`main` is the stable distribution branch; development is integrated through `develop`. The same checked-in deployment workflow works in this repository and every fork. GitHub resolves secrets and variables from the repository running the workflow, so a fork deploys only to the fork owner's Cloudflare account and publishes only that fork's verification file. By default, the workflow uses `img-hub-{repository-id}` as the Worker/D1/R2/Turnstile prefix to avoid collisions. Set the Actions repository variable `IMG_HUB_RESOURCE_PREFIX` to choose another prefix; the CLI also accepts `IMG_HUB_WORKER_NAME`, `IMG_HUB_DATABASE_NAME`, `IMG_HUB_BUCKET_NAME`, `IMG_HUB_TURNSTILE_DOMAINS`, `IMG_HUB_WECHAT_VERIFY_FILENAME`, and `IMG_HUB_WECHAT_VERIFY_CONTENT`.

The secret-free CI workflow validates pull requests to `develop` and `main`, while the stable deployment workflow verifies every `main` update before running `npm run deploy:cloudflare`. That command creates D1/R2/Turnstile resources if missing, applies the initial D1 schema, and deploys the Worker with its daily retention schedule and Turnstile secret. Fork owners must enable Actions once before a synchronized `main` can build. If the two Cloudflare secrets are absent, verification still runs and deployment is explicitly skipped. See [CONTRIBUTING.md](CONTRIBUTING.md) for branch and release rules. Template-created repositories have independent histories and do not have GitHub's **Sync fork** path.

### Destroy Cloudflare deployment

> **Danger — destructive and irreversible.** Use this only for a disposable test deployment. It permanently deletes the named Worker, every object in the R2 bucket and the bucket itself, the D1 database, and the managed Turnstile widget. It creates no backup, and deleted data cannot be recovered.

Open **Actions → DESTRUCTIVE: Destroy Cloudflare deployment → Run workflow** on `main`. Type the repository's exact `owner/repository` name, type `DESTROY owner/repository` in the second field, and select the permanent data-loss acknowledgement. The workflow refuses other branches, mismatched text, an unchecked warning, or missing Cloudflare Secrets. It uses the same repository-specific `IMG_HUB_RESOURCE_PREFIX` as `deploy.yml`, so the original repository and each fork target only their own named deployment.

The workflow first removes the Worker to stop new writes, then empties and deletes R2, deletes D1, and finally deletes Turnstile. A bucket lock prevents object deletion; remove the lock only after confirming the target and rerun the workflow. DNS records, manually created Worker routes, and other Cloudflare resources outside this named deployment are not deleted. This workflow never affects local `.wrangler/state/`; use `npm run local:reset` for disposable local data instead.

### Enable the guide site

Open **Settings → Pages** in the GitHub repository and select **GitHub Actions** as the source. The `pages.yml` workflow publishes the English and Chinese guides from `docs/`.

## API keys and Agent Skill

After changing any temporary password, open the dedicated, full-width **API keys** menu directly below **Security**, choose a name and optional expiration, and create a key. The password form in **Security** also fills its content row. Copy the `imh_...` value immediately; ImgHub stores only its hash. Revoking a key takes effect on its next request. Keys inherit the user's ownership boundary and cannot administer users, change passwords, or create other keys.

The reusable skill is in `skills/img-hub`. Copy that directory to the skills directory used by your AI agent, then expose the configuration through the agent process environment:

```sh
export IMG_HUB_URL=https://images.example.com
export IMG_HUB_API_KEY=imh_your_key_shown_once
```

The skill's dependency-free client can list, upload, replace, and delete files, and publish or replace text. For example:

```sh
python3 skills/img-hub/scripts/img_hub.py upload ./diagram.png --directory agents
python3 skills/img-hub/scripts/img_hub.py list --kind file
```

Do not put `IMG_HUB_API_KEY` in prompts, shell history, logs, or source control.

## Browser extension

Download the three assets from a GitHub Release:

- `img-hub-extension-chrome-*.zip` for Chrome
- `img-hub-extension-edge-*.zip` for Microsoft Edge
- `img-hub-extension-firefox-*.zip` for Firefox

For local installation, unzip the matching package. Load the Chrome or Edge directory with **Extensions → Developer mode → Load unpacked**. In Firefox, open `about:debugging#/runtime/this-firefox` and choose **Load Temporary Add-on**, or install the signed package once it is published to AMO. Enter the deployment URL, username, and password together, then select **Sign in**; a successful login saves the URL, username, and login token, hides the complete login surface, and leaves only the workspace. The password is never stored. When the token expires, the login surface returns with the saved URL and username already filled in.

The workspace has the same three publishing modes as the site: file upload with owner-scoped instant-upload checks, Markdown or rich-text publishing, and remote HTTP(S) file import. Its centered file surface accepts picker selection, drag-and-drop, pasted files, and clipboard images; each starts uploading immediately, while paste inside an editable field remains normal text editing. If the browser denies automatic URL copying because the popup lost focus, the successful publish remains successful and the URL can still be copied from recent uploads. It shows the 10 most recently created uploads across files and text, and **Open ImgHub** opens the configured deployment directly. The popup follows the browser's first preferred language and supports a persistent **EN / 中文** override, using the same English and Simplified Chinese catalog as the site. The fixed selection surface prevents selected-file feedback from resizing the popup. The popup opens directly at its fixed 780-pixel two-column layout, with publishing on the left and recent uploads on the right; it does not first render a narrow stacked layout and then grow.

Build all three unpacked directories and ZIPs locally with `npm run build:extension`. Development artifacts use the displayed version `0.0.0-dev` and are written to `dist/extensions/chrome/`, `dist/extensions/edge/`, and `dist/extensions/firefox/`. Build one target while debugging with `npm run build:extension:chrome`, `npm run build:extension:edge`, or `npm run build:extension:firefox`. No deployment domain is embedded, so the same artifacts connect to the original deployment or any fork.

## Version releases and browser stores

Set the application `package.json` to the release version, commit it, then push the matching tag, for example `v0.3.0`. The extension source keeps its development version at `0.0.0-dev`; `release.yml` derives the formal extension version from the tag, tests the project, builds the Chrome, Edge, and Firefox packages, deploys the tagged version to the repository's Cloudflare account when its credentials exist, and creates a GitHub Release with all three ZIP files.

Browser store publishing runs only when a complete credential set is configured as Actions secrets:

- Chrome: `CHROME_PUBLISHER_ID`, `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`
- Edge: `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`
- Firefox: `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`

Omitting one store's secrets skips that store without changing the packages or other store publications. Store listings must be created once in their developer portals before API publication can update them.

## First-run and account workflow

There is no default password for the administrator. The fixed administrator username is `admin`; the first browser that opens a new installation chooses and confirms its password in the setup form. After setup:

1. The administrator signs in and creates a user with a temporary password.
2. The user's first login succeeds but all file/text operations are blocked.
3. The user changes the temporary password.
4. Existing sessions are revoked on an administrator reset; after a normal user password change, only the current session remains.

Passwords use salted PBKDF2-SHA-256 hashes. Browser access sessions last 7 days and rotating refresh sessions last 30 days. When an access session expires, the web UI exchanges its `HttpOnly` refresh cookie once, invalidates that refresh token, and receives a new 7-day/30-day pair. Regular activity can therefore keep the login alive, while 30 days without a refresh requires password login. Both cookies are `SameSite=Strict` and `Secure` on HTTPS; D1 stores only token hashes.

Three failed logins for the same normalized username and Cloudflare client IP within 15 minutes reveal the on-demand Turnstile check. D1 stores only a SHA-256 attempt identifier and counters, never the plaintext username or IP in this table. Turnstile tokens expire after five minutes, are single-use, and are validated server-side for the `login` action and current hostname. A successful login clears the failure state. If the browser extension reaches this limit, complete a web login on the configured ImgHub site, then retry the extension.

## Browser language

The web application reads the browser's first preferred language on initial use. A locale beginning with `zh` selects Simplified Chinese; every other locale selects English. The **EN / 中文** switch in the header overrides the browser choice and persists only in that browser's local storage.

Built-in navigation, forms, dynamic messages, confirmation dialogs, dates, empty states, and common API errors are bilingual. Administrator-configured site title and welcome copy are shared across languages; the built-in unsaved welcome copy has separate English and Chinese versions.

## Administrator password recovery

ImgHub does not have a default password, email recovery, recovery question, or backdoor. If the sole administrator forgets the password, the person who controls the deployment must reset it directly through the included D1 recovery tool.

For the persistent local development database, stop `npm run dev:local`, then run:

```sh
npm run admin:reset
npm run dev:local
```

For a deployed database, authenticate Wrangler, find the exact D1 database name in the Cloudflare dashboard or with `npx wrangler d1 list`, then explicitly target it:

```sh
npx wrangler login
npm run admin:reset -- --remote --database YOUR_D1_DATABASE_NAME
```

The prompt hides the new temporary password. Verify the command reports `administrators_reset` as `1` and `administrator_username` as `admin`; `0` means the selected database has no administrator. The reset replaces only the administrator password hash, marks it temporary, deletes all administrator sessions, and revokes every active administrator API key. It also safely normalizes a legacy administrator username to `admin` and retains the former name only as a public-URL alias. Sign in as `admin` with the temporary password and choose a different permanent password immediately.

Remote reset modifies D1 directly and cannot be undone through the application. Double-check the database name and use only credentials authorized for that deployment. Never put the temporary password in command-line arguments, GitHub Actions inputs, logs, or source control.

### GitHub Actions: Reset administrator password

The manual **Reset administrator password** workflow performs the same remote D1 recovery without exposing the temporary password as a workflow input:

1. Under **Settings → Secrets and variables → Actions**, create or update the repository secret `IMG_HUB_ADMIN_RESET_PASSWORD` with a new temporary password of 10–256 characters. Keep the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` deployment secrets configured; the token needs D1 Edit access.
2. Open **Actions → Reset administrator password → Run workflow**. Enter the exact deployed D1 database name and select the reset confirmation checkbox.
3. Confirm the log reports `administrators_reset` as `1`, then sign in as `admin` with the temporary password and set a different permanent password immediately.
4. Delete `IMG_HUB_ADMIN_RESET_PASSWORD` from the repository after the successful reset.

The workflow can only be started manually. It revokes all administrator sessions and API keys and forces the next login to change the password. Do not reuse an old password or place the temporary value in the database-name field, an Actions input, an issue, or a log.

## Administration address, content audit, and account access

There is no separate `/admin` URL. Open the normal site root, such as `http://localhost:8787`, and sign in with username `admin`. The **Administration** navigation item then appears. An uninitialized database shows an administrator password-and-confirmation setup form at that same address.

If local testing shows the login form instead of setup, `.wrangler/state/` already contains an administrator. To preserve local files and accounts, stop the server and use `npm run admin:reset`. To erase all local test data and repeat first-run setup, stop the server and run `npm run local:reset`, then `npm run dev:local`. The reset command never affects a deployed database.

**Content audit** and **User management** are separate administrator navigation entries. Both lists are searched and paginated on the server, so the browser never loads every row at once. User search fills the page row, while **Create user** opens a right-side drawer instead of sharing a horizontal column with the list. Content audit can search by file name, public ID, uploader, directory, or kind and shows the link, type, upload time, uploader, and moderation state. **Block and delete source** permanently deletes the R2 object, makes the public URL return 404 even if that URL was previously cached, hides the item from its owner, and retains a D1 audit tombstone with the blocking administrator and time.

The user list provides **Disable account** and **Enable account**. Disabling immediately revokes that user's sessions and API keys, prevents login, and makes all public links owned by that account unavailable. Enabling permits a new login but does not restore old sessions or keys. The sole administrator account cannot be disabled.

## Storage and URLs

An upload by `alice` to subdirectory `trips/2026` is stored internally as:

```text
users/{alice-user-id}/file/trips/2026/lake-20260806T040506123.png
```

and published as:

```text
/pub/7b62f18c6d304476a5edc8a4de176cb1?v=1
```

Text follows the same model:

```text
users/{alice-user-id}/text/notes/hello-20260806T040506123.md
/pub/91ac1f75e0c84353bb9eca92c4f828a0?v=1
```

Subdirectories are virtual R2 prefixes. `.` and `..` segments are rejected. New names receive a millisecond UTC timestamp before their extension; blank text names become timestamped `.md` or `.html` names. D1 maps each resource to a random public ID, so its URL reveals none of the internal path. A replacement writes to the same R2 key, increments the D1 version, and returns the same public path with a new `?v=` parameter. Deletion removes the R2 object and resource metadata while retaining its activity event.

Non-image files are served as downloads. Legacy or API-created plain text is served as `text/plain`; Markdown and restricted rich text are rendered to safe HTML with a strict Content Security Policy that permits previews only from the same origin. Imported or directly uploaded SVG files are sandboxed and downloaded to avoid executing active content under the application origin.

### Public read caching

Correctly versioned GET requests such as `/pub/7b62…?v=3` are stored with the Cloudflare Cache API through `caches.default`. Every request first performs a small D1 availability check so blocked content and disabled accounts cannot bypass moderation through an old cache entry. An allowed cache hit then avoids the R2 object read. Responses expose `X-ImgHub-Cache: MISS` on the first read and `HIT` on a cached read. Invalid, missing, deleted, blocked, and expired public resources return the localized ImgHub 404 page without exposing the reason.

Only a single positive numeric `v` matching the current D1 version is stored. Unversioned URLs, incorrect versions, additional query parameters, and HEAD requests return `X-ImgHub-Cache: BYPASS`; this avoids unbounded cache-key pollution. Versioned responses use one-year shared-cache retention, while browser `max-age=0` requires the moderation check on every visit. Replacement returns a new version URL, so it misses the old cache without changing the stable path.

Cloudflare Cache API entries are local to the data center handling the request rather than globally replicated. They reduce repeated large R2 object reads and response transfer within active regions, while the D1 availability check keeps moderation authoritative.

## Site appearance

Administrators can open the separate **Site settings** menu to change the site title, tagline, welcome title, and welcome description. Values are stored in D1, validated with explicit length limits, and rendered with `textContent` rather than HTML. Defaults are used automatically until the administrator saves custom values.

## R2 retention

Open **Site settings** as the administrator and set an integer from 1 to 3650 days. The value is stored in D1 and defaults to 91. A daily scheduled Worker task lists only objects below `users/` through the existing R2 binding and removes expired objects, so no Cloudflare Account ID, bucket name, API token, or runtime management token is required.

During deployment, ImgHub removes only the obsolete fixed `img-hub-default-expiration` rule created by earlier development builds. Unrelated bucket lifecycle rules are untouched, preventing an old 91-day rule from overriding a longer administrator setting.

Reducing retention can permanently delete objects during the next maintenance run. Back up D1 and R2 before shortening the period. Local Wrangler scheduled-event testing affects only local R2 state when the bindings remain local.

## Local development

Start an interactive local service for manual testing:

```sh
npm install
npm run dev:local
```

Open `http://localhost:8787`. On a fresh local state, set the password for administrator `admin` in the setup screen, then test login, user management, file and text upload, replacement, public URLs, deletion, API keys, and site appearance from the real browser UI. To test login protection, fail three logins for a test username and confirm the Turnstile widget appears before the next attempt. Press `Ctrl+C` to stop the service.

`npm run dev:local` explicitly uses `wrangler dev --local`. D1, R2, assets, and cache run on the local machine; no binding in `wrangler.jsonc` has `remote: true`, and no Cloudflare credentials are required. The command supplies Cloudflare's published always-pass Turnstile test keys, which work on localhost and do not belong to an account; only an explicitly triggered challenge calls the public Siteverify endpoint. Local D1/R2/cache data persists under the ignored `.wrangler/state/` directory, so accounts and uploads survive restarts. The Worker creates missing tables on the first data request.

To discard only the local D1, R2, and cache data and return to the initial administrator setup, stop the development server first, then run:

```sh
npm run local:reset
npm run dev:local
```

This command never touches deployed Cloudflare resources. It removes only this checkout's `.wrangler/state/` directory.

Run the automated local checks separately:

```sh
npm test
npm run test:local
```

`npm test` uses in-memory D1 repository, R2 bucket, and Cache API doubles. `npm run test:local` additionally starts the complete Worker in an isolated, non-persistent Wrangler runtime and verifies setup, local D1, local R2, upload, cached reads, and site settings. Neither command contacts production resources.

To verify the deploy bundle without publishing:

```sh
npx wrangler deploy --dry-run
```

## Project structure

```text
src/                 Worker, authentication, D1 repositories, R2 services
public/              Dependency-free browser application
migrations/          Single initial D1 schema
local-tests/         Full Worker integration test using local D1/R2/cache
scripts/             Provisioning and deployment logic
skills/img-hub/      API-key client and reusable Agent Skill
extension/           Shared Chrome, Edge, and Firefox extension source/build
docs/                English and Chinese GitHub Pages guide
.github/workflows/   CI, stable Cloudflare deploy, release, and documentation workflows
```

## Operational notes

- The application limit is 100 MB per file and 1 MB per text entry; Cloudflare plan request limits may be lower.
- Backend retention deletion can leave metadata for an expired object in D1. The public URL then returns 404, and the owner can delete the stale metadata from the library.
- Back up D1 and R2 before reducing retention.
- Keep `wrangler.generated.json`, `.wrangler/`, API tokens, and cookie jars out of source control. They are ignored by this repository.

## License

MIT
