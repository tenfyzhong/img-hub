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
- New public paths use opaque random IDs such as `/file/pub_7b62…` and `/text/pub_91ac…`; usernames, directories, and file names are not exposed. Legacy username paths remain readable for compatibility.
- Replacing content keeps the opaque public path and R2 object key. Only the cache version changes, for example `/file/pub_7b62…?v=2`.
- The **Upload** workspace has three equal-height tabs for file upload, text publishing, and remote-file import. The separate **Manage** entry presents files and texts together in one directory tree and resource library.
- File selection, drag-and-drop, and pasting files or clipboard images start uploads immediately with progress. Uploaded and historical items can copy raw URL, Markdown, or HTML snippets.
- The file manager provides directory-tree filtering and grid/list views; HTTP(S) URLs for images, documents, archives, audio, video, text, and other files can be fetched after private-network and size checks, with live byte progress followed by the storage-saving stage.
- Text supports plain text, Markdown, and a restricted rich-text editor. Upload, import, replacement, and deletion events remain available in a D1-backed timeline.
- Administrators can configure the R2 Object Lifecycle Rule from the UI. The default is 91 days; unrelated rules are preserved.
- Users can create named, revocable API keys. Only a hash of each key is stored, and the cleartext value is shown once.
- The bundled Agent Skill uploads and manages resources with an API key; the browser extension supports Chrome, Edge, and Firefox with a configurable deployment URL.
- Versioned `/file` and `/text` reads use `caches.default`; after a small moderation check in D1, cache hits skip the R2 object read.
- Administrators can customize the site title, tagline, welcome title, and welcome description.
- The application has no third-party storage channels. It uses Cloudflare R2 only.

## Deployment option 1: Cloudflare Deploy button

Click the button above, authorize Cloudflare, keep the detected `npm run deploy` command, and deploy the repository. The shared deployment command provisions D1 and R2, applies migrations, creates or reuses a managed Turnstile widget for the generated hostname, stores its secret as a Worker Secret, and deploys ImgHub. Turnstile configuration requires **Turnstile Sites Write** in addition to the Worker/D1/R2 permissions granted to the build.

After deployment:

1. Open the generated `workers.dev` URL.
2. Set a password for the fixed administrator username `admin`. The setup endpoint is disabled after that account exists.
3. In **Administration → R2 retention**, enter the account ID, created bucket name, and a short-lived API token with **Workers R2 Storage Write** permission. The form defaults to 91 days. The token is used for that request and is never stored.
4. Create user accounts and distribute their temporary passwords securely.

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
3. Generates an untracked binding configuration and applies all D1 migrations.
4. Installs the managed `users/` lifecycle rule with a 91-day expiration.
5. Creates or reuses a managed Turnstile widget and securely installs its secret.
6. Deploys the Worker and static application.

The script never deletes a database or bucket. Override names and placement when needed:

```sh
IMG_HUB_DATABASE_NAME=my-hub-db \
IMG_HUB_BUCKET_NAME=my-hub-files \
IMG_HUB_RETENTION_DAYS=180 \
IMG_HUB_D1_LOCATION=apac \
IMG_HUB_R2_LOCATION=apac \
IMG_HUB_TURNSTILE_DOMAINS=images.example.com \
./deploy.sh
```

Valid D1/R2 location values are controlled by Wrangler. Omit placement variables to let Cloudflare choose. The script discovers the generated `workers.dev` hostname automatically; set the comma-separated `IMG_HUB_TURNSTILE_DOMAINS` only to authorize additional custom hostnames. A widget allows its configured hostname and subdomains, and Cloudflare limits each widget to 10 entries.

## Deployment option 3: GitHub Actions

The repository contains focused workflows for secret-free CI, stable Cloudflare deployment, tagged releases, browser packages, and GitHub Pages documentation.

1. Fork the repository when you want **Sync fork** updates, or create an independent repository from this Template repository. The maintainer must enable **Settings → General → Template repository** once for the **Use this template** button to appear.
2. Create a Cloudflare API token that can edit Workers, D1, R2, and Turnstile resources. R2 lifecycle management requires **Workers R2 Storage Write** and automatic login protection requires **Turnstile Sites Write**.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Open **Actions → Deploy to Cloudflare → Run workflow**, or push to `main`.

`main` is the stable distribution branch; development is integrated through `develop`. The same checked-in deployment workflow works in this repository and every fork. GitHub resolves secrets from the repository running the workflow, so a fork deploys only to the fork owner's Cloudflare account. By default, the workflow uses `img-hub-{repository-id}` as the Worker/D1/R2/Turnstile prefix to avoid collisions. Set the Actions repository variable `IMG_HUB_RESOURCE_PREFIX` to choose another prefix; the CLI also accepts `IMG_HUB_WORKER_NAME`, `IMG_HUB_DATABASE_NAME`, `IMG_HUB_BUCKET_NAME`, `IMG_HUB_RETENTION_DAYS`, and `IMG_HUB_TURNSTILE_DOMAINS`.

The secret-free CI workflow validates pull requests to `develop` and `main`, while the stable deployment workflow verifies every `main` update before running `npm run deploy:cloudflare`. That command creates D1/R2/Turnstile resources if missing, applies D1 migrations, configures the 91-day R2 lifecycle rule, and deploys the Worker with the Turnstile secret. Fork owners must enable Actions once before a synchronized `main` can build. If the two Cloudflare secrets are absent, verification still runs and deployment is explicitly skipped. See [CONTRIBUTING.md](CONTRIBUTING.md) for branch and release rules. Template-created repositories have independent histories and do not have GitHub's **Sync fork** path.

### Enable the guide site

Open **Settings → Pages** in the GitHub repository and select **GitHub Actions** as the source. The `pages.yml` workflow publishes the English and Chinese guides from `docs/`.

## API keys and Agent Skill

After changing any temporary password, open the dedicated **API keys** menu directly below **Security**, choose a name and optional expiration, and create a key. Copy the `imh_...` value immediately; ImgHub stores only its hash. Revoking a key takes effect on its next request. Keys inherit the user's ownership boundary and cannot administer users, change passwords, or create other keys.

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

Download the two assets from a GitHub Release:

- `img-hub-extension-chromium-*.zip` for Chrome and Edge
- `img-hub-extension-firefox-*.zip` for Firefox

For local installation, unzip the matching package. Load the Chromium directory with **Extensions → Developer mode → Load unpacked**. In Firefox, open `about:debugging#/runtime/this-firefox` and choose **Load Temporary Add-on**, or install the signed package once it is published to AMO. Open the extension, grant access to your deployment URL, and sign in. The extension stores the deployment URL and login token in extension-local storage; it never stores the password. It supports image upload, listing, URL copy, replacement, and deletion.

Build both generic packages locally with `npm run build:extension`. No deployment domain is embedded, so the same release artifacts connect to the original deployment or any fork.

## Version releases and browser stores

Set `package.json` to a numeric extension version, commit it, then push the matching tag, for example `v0.2.0`. `release.yml` tests the project, builds both extension packages, deploys the tagged version to the repository's Cloudflare account when its credentials exist, and creates a GitHub Release with both ZIP files.

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

Passwords use salted PBKDF2-SHA-256 hashes. Session cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS; D1 stores only session-token hashes.

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

## Administration address, content audit, and account access

There is no separate `/admin` URL. Open the normal site root, such as `http://localhost:8787`, and sign in with username `admin`. The **Administration** navigation item then appears. An uninitialized database shows an administrator password-and-confirmation setup form at that same address.

If local testing shows the login form instead of setup, `.wrangler/state/` already contains an administrator. To preserve local files and accounts, stop the server and use `npm run admin:reset`. To erase all local test data and repeat first-run setup, stop the server and run `npm run local:reset`, then `npm run dev:local`. The reset command never affects a deployed database.

The **Administration → Content audit** list shows each file or text link, its type, upload time, uploader, and moderation state. **Block and delete source** permanently deletes the R2 object, makes the public URL return 404 even if that URL was previously cached, hides the item from its owner, and retains a D1 audit tombstone with the blocking administrator and time. A blocked path cannot be uploaded again under the same owner and name.

The user list provides **Disable account** and **Enable account**. Disabling immediately revokes that user's sessions and API keys, prevents login, and makes all public links owned by that account unavailable. Enabling permits a new login but does not restore old sessions or keys. The sole administrator account cannot be disabled.

## Storage and URLs

An upload by `alice` to subdirectory `trips/2026` is stored internally as:

```text
users/{alice-user-id}/file/trips/2026/lake.png
```

and published as:

```text
/file/pub_7b62f18c6d304476a5edc8a4de176cb1?v=1
```

Text follows the same model:

```text
users/{alice-user-id}/text/notes/hello.txt
/text/pub_91ac1f75e0c84353bb9eca92c4f828a0?v=1
```

Subdirectories are virtual R2 prefixes. `.` and `..` segments are rejected. D1 maps each resource to a random public ID, so its URL reveals none of the internal path. A replacement writes to the same R2 key, increments the D1 version, and returns the same public path with a new `?v=` parameter. Deletion removes the R2 object and resource metadata while retaining its activity event.

Non-image files are served as downloads. Plain text published through the text editor is served as `text/plain`; Markdown and restricted rich text are rendered to safe HTML with a strict Content Security Policy. Imported or directly uploaded SVG files are sandboxed and downloaded to avoid executing active content under the application origin.

### Public read caching

Correctly versioned GET requests such as `/file/pub_7b62…?v=3` and `/text/pub_91ac…?v=2` are stored with the Cloudflare Cache API through `caches.default`. Every request first performs a small D1 availability check so blocked content and disabled accounts cannot bypass moderation through an old cache entry. An allowed cache hit then avoids the R2 object read. Responses expose `X-ImgHub-Cache: MISS` on the first read and `HIT` on a cached read.

Only a single positive numeric `v` matching the current D1 version is stored. Unversioned URLs, incorrect versions, additional query parameters, and HEAD requests return `X-ImgHub-Cache: BYPASS`; this avoids unbounded cache-key pollution. Versioned responses use one-year shared-cache retention, while browser `max-age=0` requires the moderation check on every visit. Replacement returns a new version URL, so it misses the old cache without changing the stable path.

Cloudflare Cache API entries are local to the data center handling the request rather than globally replicated. They reduce repeated large R2 object reads and response transfer within active regions, while the D1 availability check keeps moderation authoritative.

## Site appearance

Administrators can open **Administration → Site appearance** to change the site title, tagline, welcome title, and welcome description. Values are stored in D1, validated with explicit length limits, and rendered with `textContent` rather than HTML. Defaults are used automatically until the administrator saves custom values.

## R2 lifecycle administration

The administration screen reads the current rules with the Cloudflare API, removes only the rule named `img-hub-default-expiration`, and writes it back with the selected age and the `users/` prefix. All other lifecycle rules remain intact.

The submitted API token is not written to D1, R2, logs, or browser storage. Prefer a narrowly scoped, short-lived token. Lifecycle deletion is irreversible and may take time to be reflected by R2; choose a retention period appropriate for your backups and billing needs.

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
migrations/          Idempotent D1 schema migrations
local-tests/         Full Worker integration test using local D1/R2/cache
scripts/             Provisioning and deployment logic
skills/img-hub/      API-key client and reusable Agent Skill
extension/           Shared Chrome, Edge, and Firefox extension source/build
docs/                English and Chinese GitHub Pages guide
.github/workflows/   CI, stable Cloudflare deploy, release, and documentation workflows
```

## Operational notes

- The application limit is 100 MB per file and 1 MB per text entry; Cloudflare plan request limits may be lower.
- R2 lifecycle deletion can leave metadata for an expired object in D1. The public URL then returns 404, and the owner can delete the stale metadata from the library.
- Back up D1 and R2 before reducing retention.
- Keep `wrangler.generated.json`, `.wrangler/`, API tokens, and cookie jars out of source control. They are ignored by this repository.

## License

MIT
