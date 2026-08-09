# Contributing to ImgHub

[中文贡献指南](CONTRIBUTING.zh-CN.md)

Thank you for helping improve ImgHub. This guide describes the expected development workflow, automated checks, manual browser testing, and pull request requirements.

## Before starting

- Search existing issues and pull requests before opening a duplicate.
- For a substantial feature or behavior change, open an issue first so the design and scope can be agreed upon.
- Keep each pull request focused. Unrelated refactors make security and ownership changes harder to review.
- Never post passwords, API keys, Cloudflare tokens, cookies, private deployment URLs, or user content in issues, test output, commits, or screenshots.
- Do not open a public issue for a vulnerability that exposes credentials or user data. Contact a repository maintainer privately through their GitHub profile until a private reporting channel is published.

## Requirements

- Git
- Node.js 22 or newer
- npm, included with Node.js
- Chrome, Edge, or Firefox when changing the browser extension

A Cloudflare account is not required for normal development or testing. Wrangler simulates D1, R2, static assets, and the Cache API locally.

## Set up a development checkout

Fork the repository, clone your fork, and install the locked dependencies:

```sh
git clone https://github.com/YOUR-USER/img-hub.git
cd img-hub
git remote add upstream https://github.com/tenfyzhong/img-hub.git
npm ci
npm test
```

Keep your fork's `main` aligned with the stable upstream branch. Do not put personal changes on `main`:

```sh
git fetch upstream --prune
git switch main
git merge --ff-only upstream/main
git push origin main
```

Create the local `develop` branch from upstream the first time:

```sh
git switch -c develop --track upstream/develop
```

For each change, update `develop` and create a short-lived branch:

```sh
git switch develop
git pull --ff-only upstream develop
git switch -c feature/short-description
```

If you use Git worktrees, create them below this checkout's `.git/wtm/` directory:

```sh
git worktree add .git/wtm/short-description -b feature/short-description upstream/develop
```

## Branch and release workflow

ImgHub uses a lightweight Git Flow so the default branch is always safe for forks to sync and deploy:

```text
feature/* ──PR──> develop ──release PR──> main ──v* tag──> GitHub Release
                    │                       │                 │
                    └── CI only             └── deploy        └── deploy and package extensions

hotfix/* (from main) ──PR──> main ──merge back──> develop
upstream/main ──Sync fork──> fork/main ──verify──> fork Cloudflare deployment
```

| Branch | Purpose | Production deployment |
| --- | --- | --- |
| `main` | Stable, deployable default branch distributed to forks | On every push or fork sync when repository credentials exist |
| `develop` | Integration branch for the next version | Never |
| `feature/*`, `fix/*`, `docs/*` | Short-lived work based on `develop` | Never |
| `release/*` | Optional stabilization, version, and release notes | After merging to `main` |
| `hotfix/*` | Urgent correction based on `main` | After merging to `main` |
| `v*` tag | Immutable formal release from `main` | Idempotent release deployment plus GitHub and extension releases |

Normal feature, fix, refactor, and documentation pull requests must target `develop`. Only `develop`, `release/*`, and `hotfix/*` are accepted as sources for a pull request targeting `main`; CI enforces this rule. After a hotfix reaches `main`, merge it back into `develop` before continuing feature work.

For a release:

1. Create `release/vX.Y.Z` from `develop` when stabilization work is needed, otherwise use `develop` directly.
2. Update `package.json`, English and Chinese documentation, and release-sensitive tests.
3. Complete automated and manual verification.
4. Open the release pull request against `main` and obtain review.
5. Merge it, create the matching signed `vX.Y.Z` tag from `main`, and push the tag.
6. Merge `main` back into `develop`.

The release workflow rejects a tag whose version does not match `package.json` or whose commit is not contained in `main`.

### Repository rulesets

Maintainers should create active GitHub Rulesets for both long-lived branches. Protect `main` with required pull requests, at least one approval, the CI `verify` and `branch-policy` checks, blocked force pushes, and blocked deletion. Protect `develop` with required pull requests, the CI `verify` check, blocked force pushes, and blocked deletion. Do not allow routine administrator bypasses.

Rulesets are repository settings and cannot be activated merely by committing a YAML file. A maintainer must configure them after creating `develop`:

```sh
git switch main
git pull --ff-only origin main
git switch -c develop
git push origin develop
```

### Fork and template updates

For a fork that should track upstream, enable GitHub Actions once, keep `main` free of custom commits, configure that fork's own Cloudflare Secrets and Variables, then use **Sync fork → Update branch**. The stable `main` update runs verification and deploys only with the fork's credentials. Feature work belongs on another branch and should target upstream `develop`.

Optional WeChat site verification uses the fork-local Repository Variables `IMG_HUB_WECHAT_VERIFY_FILENAME` and `IMG_HUB_WECHAT_VERIFY_CONTENT`. Both must be configured together. The deploy and release workflows inject the public root `.txt` file into a temporary Assets copy; they must never write the supplied value into `public/`, source control, fixtures, or logs. Deployment changes to this path belong in `test/deployment.test.js`; use placeholder content only and verify unsafe filenames fail before any Cloudflare command runs.

A repository made with **Use this template** is an independent snapshot with unrelated Git history, not a GitHub fork. It does not receive the **Sync fork** update path. Choose a real fork when automatic upstream alignment matters; choose the template when intentionally maintaining an independent product.

## Repository layout

```text
src/                 Worker routes, authentication, D1 repositories, R2 services
public/              Browser application served by Workers Assets
migrations/          Single initial D1 schema
test/                 Reusable Node.js unit and contract tests
local-tests/          Complete Worker test with local D1, R2, assets, and cache
extension/            Shared Chrome, Edge, and Firefox extension
skills/img-hub/       API-key client and Agent Skill
scripts/              Deployment, release, extension, and local utilities
docs/                 English and Chinese GitHub Pages guide
.github/workflows/    Test, deploy, release, and Pages automation
```

## Development rules

### Use test-driven development

For a feature, bug fix, refactor, or behavior change:

1. Add a reusable test using the existing Node.js test framework.
2. Run it and confirm it fails for the expected reason.
3. Implement the smallest complete change that makes the test pass.
4. Run the focused test again, followed by the full suites.

Documentation-only and configuration-only changes do not need an artificial failing test. Update an existing contract test when the documentation or configuration has a machine-verifiable requirement.

### Preserve security and isolation

- Every resource operation must enforce the authenticated owner boundary.
- Keep R2 objects under `users/{user-id}/file/` or `users/{user-id}/text/`.
- Store hashes rather than plaintext passwords, sessions, or API keys.
- Keep Turnstile fail-closed after three failed logins, validate tokens server-side, and keep plaintext usernames and IP addresses out of `login_challenges`.
- Keep state-changing browser requests same-origin protected.
- Do not add remote D1 or R2 bindings to the default development configuration.
- Until the first public release, fold every schema change into `migrations/0001_initial.sql` and keep runtime schema initialization aligned; do not add incremental migration files.
- Public replacement URLs must keep their path and increment the `?v=` cache version.

### Style and commits

- Follow the existing indentation: four spaces in JavaScript and two spaces in JSON/YAML.
- Do not leave trailing whitespace.
- Do not commit `.wrangler/`, generated deployment configuration, `dist/`, credentials, cookies, or local uploads.
- Keep commits small and explain why a behavior changed.
- Sign off every commit for the Developer Certificate of Origin:

```sh
git commit -s -m "feat: describe the change"
```

## Automated tests

Run the reusable unit and contract tests:

```sh
npm test
```

Run the complete Worker with isolated local D1, R2, assets, and cache simulations:

```sh
npm run test:local
```

This command does not require Cloudflare credentials, does not contact deployed D1/R2 resources, and does not overwrite the persistent data used by `npm run dev:local`.

Run checks relevant to the changed area:

```sh
# Verify the Worker bundle without deploying it
npm run check:deploy

# Build generic Chromium and Firefox extension packages
npm run build:extension

# Check dependency vulnerabilities
npm audit --audit-level=moderate
```

The secret-free `ci.yml` runs these checks for pull requests to `develop` or `main` and for pushes to `develop`. `deploy.yml` independently verifies every stable `main` update before using the current repository's Cloudflare credentials. Changes to deployment scripts or workflows should pass `npm run check:deploy`. Extension changes should pass `npm run build:extension` and the browser checks below. Documentation changes should keep the English and Chinese guides aligned.

### Destroy Cloudflare deployment workflow

The manual destruction workflow is destructive and irreversible: it deletes the named Worker, every R2 object and its bucket, the D1 database, and the managed Turnstile widget without creating a backup. Never run it as ordinary manual verification. Validate changes with `test/destroy.test.js`; a live run requires the repository owner's explicit authorization and an isolated, disposable Cloudflare deployment. Bucket locks must make the run fail safely until an authorized operator removes them.

## Manual web application testing

Start the full application locally:

```sh
npm ci
npm run dev:local
```

Open `http://localhost:8787`. The server uses only local D1, R2, assets, and cache bindings. Press `Ctrl+C` to stop it. Data persists under `.wrangler/state/`, so accounts and uploads survive restarts.

To repeat the first-run flow, stop the server and explicitly remove the local state:

```sh
npm run local:reset
npm run dev:local
```

`npm run local:reset` permanently deletes only this checkout's local D1, R2, and cache data. It cannot delete deployed Cloudflare resources.

### Turnstile login testing

`npm run dev:local` supplies Cloudflare's published always-pass Turnstile test keys. D1, R2, assets, and cache remain local; no Cloudflare account or production storage is used. With a disposable username, make three failed login attempts within 15 minutes. Confirm the third response reveals the bilingual challenge, the next attempt cannot reach password verification without a token, completing the widget allows one attempt, and a successful login clears the failure state. Each failed retry after the threshold must require a fresh token. Do not replace the local test keys with production keys.

### Administrator recovery testing

There is no default administrator password or public recovery endpoint. The fixed administrator username is `admin`. To test recovery, create a local administrator, stop Wrangler, run `npm run admin:reset`, restart `npm run dev:local`, and sign in as `admin` with the prompted temporary password. Confirm all earlier administrator sessions and API keys are revoked and that the UI requires a different permanent password before content operations.

Remote recovery requires `npm run admin:reset -- --remote --database <D1_DATABASE_NAME>` and directly modifies D1. Never run it against a shared or production database for routine contribution testing. A live recovery test requires explicit authorization and a disposable database.

Changes to `.github/workflows/reset-admin-password.yml` should be validated by `test/admin-recovery.test.js`. Do not dispatch that workflow merely to test YAML: a live run directly changes the selected D1 database, revokes administrator credentials, and requires explicit authorization plus a disposable deployment.

### Language testing

Clear the `img-hub-language` local storage key and change the browser's first preferred language. Confirm a `zh` locale opens the Chinese UI and another locale opens English. Then use **EN / 中文**, reload, and confirm the explicit choice persists. Check setup, login, forced password change, all three Upload tabs, the unified resource manager, Security, Administration, dynamic messages, errors, confirmation dialogs, and mobile navigation in both languages. Administrator-configured site appearance is intentionally shared across languages; built-in unsaved welcome copy is localized.

### Content audit and disable account testing

The administration UI is part of the normal site root; there is no separate `/admin` route. Sign in as the administrator and open the dedicated **Content audit** and **User management** menus. Verify that searches filter on the server, page buttons fetch only the selected page, and empty searches restore the full paginated list. Upload a disposable file and text as another user, then verify Content audit identifies the uploader and exact public link. Open the link until it reports a cache hit, block it, and confirm the link immediately returns 404, the owner no longer lists it, and the audit tombstone remains. Use only disposable content because blocking permanently deletes the source object.

Disable account for the test user and confirm its browser sessions and API keys stop working, login is rejected, and all of its public links return 404. Re-enable it and confirm a fresh password login works while old credentials remain revoked. Confirm the administrator cannot be disabled.

Use this manual checklist for changes that affect user behavior:

1. On a fresh state, set the password for administrator `admin` and confirm setup is no longer offered after signing in.
2. As the administrator, open the user-creation drawer and generate a temporary password. Confirm both password fields match, the value is copied immediately, and a success Toast disappears after about two seconds. Click **Copy password** again and confirm the button animates, the clipboard value matches, and the two-second Toast appears again; then create the regular user.
3. Sign in as that user and confirm content operations are blocked until the password is changed.
4. Change the password, sign in again, and create nested directories while uploading a file and publishing text.
5. Confirm file and text public URLs both match `/pub/{32-character-random-id}?v=N`, include no `pub_` prefix, resource kind, username, directory, or file name, and retain the same random path after replacement. Open a missing `/pub/` URL and confirm the localized 404 page appears.
6. Open a public URL twice. In browser developer tools, confirm the first versioned GET reports `X-ImgHub-Cache: MISS` and a repeated GET can report `HIT`. Unversioned or incorrect versions should report `BYPASS`.
7. Replace file and text content. Confirm the path stays unchanged, `?v=` increments, and the new URL returns the new content.
8. Delete each resource and confirm it disappears from the owner's list and its public URL no longer resolves.
9. Open the dedicated **API keys** menu directly below **Security**. Confirm its surface fills the content row, create multiple keys, and verify the list expands downward on its own page, the cleartext value is shown once, an owner-scoped request succeeds, and revocation takes effect.
10. As the administrator, change the site title and welcome copy and confirm both the page and browser title update.
11. Reset the regular user's password and confirm existing sessions and API keys stop working and the password-change requirement returns.
12. Open the separate **Content audit** and **User management** menus. Confirm search filters both lists, clearing the search restores all rows, and data beyond 20 results is reached with Previous/Next without lengthening the current page. Confirm user search fills the row and **Create user** opens and closes a right-side drawer instead of placing a second column beside the list. Audit a file and text and confirm each row shows its public URL and uploader.
13. Cache a disposable resource, block it, and confirm the source is deleted, the public URL returns 404, and the audit tombstone remains.
14. Disable and re-enable a regular account; confirm sessions/API keys are revoked and public links are unavailable while disabled.
15. Confirm the **Security** password surface fills the content row. Verify every password-setting form rejects mismatched confirmation, shows a closed eye while the password is hidden and an open eye while visible, and administrator password generation fills both fields and copies the same value.
16. In **Upload & publish**, confirm the three tabs fill one complete row, then switch through **Upload files**, **Publish text**, and the last **Import file** tab. Confirm all three panels keep the same responsive height without making the workspace scroll vertically. Click the enlarged drop zone, drag another file into it, paste a copied file, and paste a screenshot or other clipboard image while the file-upload panel is active. Confirm all four immediately hash and upload with progress and URL/Markdown/HTML copy, with no separate file-picker button. Use the **×** close button and confirm only the copy-result panel disappears while the published resource remains. Publish again, then switch an upload tab and a sidebar menu; confirm each navigation clears the result panel automatically. Upload the same file again and confirm the MD5 check completes it without client upload while creating a different resource and R2 object. Confirm every new name contains a millisecond timestamp, an unnamed clipboard image receives a safe generated base name, and pasting text into the directory or text editor still edits that field instead of uploading.
17. In **Manage**, confirm files and texts are mixed in one resource list and share one root directory tree, with no type tabs. Verify directory filtering, grid/list modes, replacement, and deletion. Confirm the publishing form offers Markdown and rich text but no plain-text option, the file-name field is optional, both editor frames stay the same size, and the original content can be edited. Publish once with a name and once without one; confirm both receive timestamped names and both show URL/Markdown/HTML copy actions. Upload an oversized or unusually tall image and confirm its preview remains fully inside its card in both views. Confirm Markdown and rich-text resources show sandboxed in-card previews. From the third Upload tab, import disposable image and non-image HTTP(S) files such as a PDF or ZIP; confirm known-length responses show byte percentage, unknown-length responses show indeterminate progress with fetched bytes, the label changes to the storage-saving stage, non-images download safely, and completed imports appear in the timeline.
18. In browser storage tools, confirm login creates HttpOnly access and refresh cookies. Delete only `img_hub_session`, reload, and confirm the refresh request keeps the user signed in while rotating both cookies. Delete both cookies and confirm password login is required. Administrator password reset and account disable must also invalidate refresh sessions.
19. Make three failed logins for a disposable user, confirm Turnstile appears in English and Chinese, complete it, and verify a correct login clears the challenge state.

To inspect cache headers without a browser, use a current public URL returned by the application. Use GET rather than `curl -I`, because HEAD intentionally bypasses cache storage:

```sh
curl --silent --show-error --dump-header - --output /dev/null \
  'http://localhost:8787/pub/REPLACE_WITH_CURRENT_32_CHARACTER_ID?v=1'
```

### R2 backend retention

Under **Site settings**, confirm the administrator can save an integer from 1 to 3650 days and that reload preserves it. The deployed Worker defaults to 91 days and runs a daily scheduled cleanup through the existing R2 binding; the browser never asks for a Cloudflare Account ID, bucket name, or API token. Validate the deletion boundary without contacting Cloudflare with:

```sh
node --test test/lifecycle.test.js
```

Do not trigger retention against deployed R2 data during routine testing. Use the repository R2 double or an explicitly isolated local Wrangler state; only use disposable live data when the user explicitly authorizes it.

## Manual browser extension testing

Build both extension variants:

```sh
npm run build:extension
```

Keep `npm run dev:local` running, then test against `http://localhost:8787`:

- Chrome or Edge: open the extensions page, enable Developer mode, choose **Load unpacked**, and select `dist/extensions/chromium/`.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/extensions/firefox/manifest.json`.
- In the popup, configure the local URL, grant host access, and sign in with a test account.
- Verify upload, list refresh, URL copy, replacement, deletion, logout, invalid credentials, and a restarted local service.
- Test both browser packages when changing shared popup code or permissions.

Generated `dist/extensions/` files are test artifacts and must not be committed.

## Manual Agent Skill testing

Create a disposable API key from the local UI and expose it only to the command process:

```sh
export IMG_HUB_URL=http://localhost:8787
export IMG_HUB_API_KEY=imh_value_shown_once
python3 skills/img-hub/scripts/img_hub.py list
python3 skills/img-hub/scripts/img_hub.py upload ./example.png --directory contribution-test
```

Verify list, upload, replacement, deletion, text publication, an invalid key, and a revoked key when changing the client. Revoke the disposable key after testing and do not put its value in terminal recordings or pull request logs.

## Pull request checklist

Before pushing:

```sh
npm test
npm run test:local
npm run check:deploy
git diff --check
git status --short
```

Also run `npm run build:extension` for extension or release changes. In the pull request:

- Target `develop` for feature, fix, refactor, and documentation work. Target `main` only for a release or hotfix.
- Describe the problem and the behavior after the change.
- Link the related issue when one exists.
- State which automated commands passed.
- Describe manual test steps and results, or explain why manual testing is not applicable.
- Include screenshots only when they clarify a visible UI change, and remove account or user data first.
- Call out migrations, compatibility effects, cache behavior, security considerations, and deployment changes.
- Confirm every commit contains a `Signed-off-by` line created with `git commit -s`.

Maintainers may ask for a smaller scope, additional tests, documentation updates, or a clean rebase before merging.
