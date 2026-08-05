# AGENTS

Repository-specific instructions for coding agents working on ImgHub. This file applies to the entire repository. More deeply nested `AGENTS.md` files, if added later, may refine rules for their directories but must not weaken the security and data-isolation invariants below.

## Project mission

ImgHub is a self-hosted, multi-user file and text hub for Cloudflare Workers. It uses only:

- Cloudflare Workers for HTTP and application logic
- D1 for users, sessions, API keys, resource metadata, and settings
- R2 for file and text objects
- Workers Assets for the browser application
- Cache API for public versioned reads

Do not introduce another messaging, repository-backed, or third-party storage provider. Do not introduce the names, assets, backgrounds, copy, or implementation traces of reference or predecessor projects. New branding and visual assets must remain original to ImgHub.

## Environment and tools

- Shell: fish. Keep documented shell examples portable when practical.
- Runtime: Node.js 22 or newer.
- Module system: native ECMAScript modules (`"type": "module"`).
- Package manager: npm; use `npm ci` when validating the lockfile.
- Prefer `rg` and `rg --files` for repository searches.
- GNU-style coreutils, binutils, findutils, awk, sed, tar, and grep are available.
- Never expose environment variables, Secrets, API keys, cookies, or tokens in command output or documentation examples.

Install dependencies with:

```sh
npm ci
```

## Git workflow

ImgHub uses a lightweight Git Flow:

- `main` is always stable and deployable. Fork users synchronize this branch.
- `develop` integrates the next version and never deploys to production.
- `feature/*`, `fix/*`, and `docs/*` branch from `develop` and target `develop`.
- `release/*` stabilizes a release and targets `main`.
- `hotfix/*` branches from `main`, targets `main`, and must be merged back to `develop`.
- Formal `v*` tags must point to commits contained in `main` and match `package.json`.

Before implementing changes in a repository with a remote, run `git pull --ff-only` when the working tree and branch make that safe. If the working tree is dirty, preserve all existing work: fetch and compare refs rather than stashing, resetting, or overwriting user changes.

Create any Git worktree under the project directory's `.git/wtm/` directory. Do not place worktrees elsewhere.

Do not commit, push, tag, publish a Release, deploy, or modify GitHub repository settings unless the user explicitly asks. When a commit is requested, every commit must be signed off:

```sh
git commit -s -m "type: concise description"
```

Never force-push `main` or `develop`. Never put development-only code on `main`.

## Test-driven development

Features, fixes, refactors, and behavior changes require TDD:

1. Add or update a reusable test in the project's Node.js test framework.
2. Run the focused test and verify it fails for the expected reason.
3. Implement the smallest complete production change.
4. Run the focused test until it passes.
5. Run the relevant full validation commands.

Do not add production behavior before a failing test exists. Documentation-only and configuration-only changes are exempt from an artificial failure, but update contract tests whenever a machine-verifiable workflow, documentation, or configuration guarantee changes.

Primary commands:

```sh
npm test
npm run test:local
npm run check:deploy
npm run build:extension
npm audit --audit-level=moderate
git diff --check
```

- `npm test` runs unit and contract tests with repository, R2, and Cache API doubles.
- `npm run test:local` also starts the complete Worker with isolated local D1, R2, Assets, and Cache API simulations.
- Neither test command may require Cloudflare credentials or contact production D1/R2 resources.
- `npm run check:deploy` builds the Worker through a Wrangler dry run and must not publish it.
- Run `npm run build:extension` for extension, release, manifest, permission, or shared popup changes.

Use existing focused tests when possible:

```text
test/auth*.test.js             authentication, sessions, hashing, origin checks
test/users.test.js             administrator and password workflows
test/admin-recovery.test.js    deployment-owner administrator recovery
test/api-keys.test.js          API key creation, hashing, expiry, and revocation
test/resources.test.js         ownership, upload, text, replacement, and deletion
test/public-cache.test.js      versioned public read cache behavior
test/lifecycle.test.js         Cloudflare R2 lifecycle request behavior
test/site-settings.test.js     administrator site appearance settings
test/frontend.test.js          browser application contract
test/i18n.test.js              language selection and translation catalogs
test/extension.test.js         extension manifests and packages
test/skill.test.js             Agent Skill and API client
test/deployment.test.js        D1/R2 provisioning, CI, and stable deployment
test/release.test.js           Release and browser store publication
test/docs.test.js              bilingual deployment documentation
test/contributing.test.js      contributor, PR, and agent guidance
local-tests/worker.mjs         complete isolated Worker integration
```

Do not create one-off test scripts when a reusable test belongs in `test/` or `local-tests/`.

## Local manual testing

Start the full application without real Cloudflare resources:

```sh
npm run dev:local
```

Open `http://localhost:8787`. Local D1, R2, Assets, and Cache API state persists under `.wrangler/state/`.

To return to first-run setup, stop Wrangler before running:

```sh
npm run local:reset
```

This is destructive to local test accounts and objects. It must remove only this checkout's `.wrangler/state/` and must never target deployed resources or a broad filesystem path.

Follow the manual checklist in `CONTRIBUTING.md` or `CONTRIBUTING.zh-CN.md` for user-visible changes. Do not submit the local **R2 retention** form during offline testing: that endpoint intentionally calls the real Cloudflare lifecycle API. Use `test/lifecycle.test.js` unless a user explicitly authorizes a disposable live integration test.

## Architecture map

```text
src/index.js                    Worker entry point and route composition
src/schema.js                   idempotent runtime D1 initialization
src/database.js                 D1 repository adapters and row mapping
src/auth*.js                    passwords, sessions, and authentication
src/login-protection.js         hashed login-failure windows and challenge enforcement
src/turnstile.js                server-side Turnstile Siteverify validation
src/user-service.js             administrator and password management
src/api-key-service.js          API key lifecycle and authentication
src/resource-service.js         owned R2 file/text operations
src/public-resource.js          public responses and Cache API integration
src/site-settings-service.js    public/admin appearance settings
src/lifecycle.js                Cloudflare R2 lifecycle API integration
src/http.js / src/paths.js      HTTP guards, routes, names, and path safety
public/                         dependency-free browser UI
public/i18n.js                  English/Chinese catalogs and locale selection
migrations/                     deploy-time D1 migrations
extension/                      generic cross-browser extension source/build
skills/img-hub/                 distributable agent skill and Python client
scripts/                        provisioning, deployment, reset, and publishing
.github/workflows/              CI, stable deployment, release, and Pages
```

Keep route handling thin. Put reusable authorization, validation, persistence, object, cache, and lifecycle behavior in the corresponding modules so it remains unit-testable.

## Data and security invariants

### Users and authentication

- The first successful setup creates the sole administrator with the fixed username `admin`; setup closes afterward.
- Legacy administrator names normalize to `admin` only when conflict-free. Preserve the former name in `username_aliases` so existing public URLs continue to work; aliases must not be accepted for login or regular-user creation.
- There is no default administrator password, public password-recovery endpoint, email reset, or backdoor.
- Administrator-assigned and reset passwords set `mustChangePassword`.
- Users with a temporary password cannot manage content or create API keys until changing it.
- Passwords are salted hashes. Session and API key cleartext values must never be persisted.
- Resetting a password revokes the user's sessions and API keys.
- Deployment-owner recovery uses `scripts/reset-admin-password.mjs`; remote recovery requires an explicit database name, stores only a new hash, revokes administrator sessions/API keys, and forces a different password after login.
- Browser-only security operations must continue to require an appropriate login session.
- State-changing browser requests must retain same-origin protection.
- Error responses must not reveal whether a username, password, session, or API key exists.
- Three failed logins for a normalized username/client-IP pair within 15 minutes require Turnstile. Store only the pair's SHA-256 identifier in `login_challenges`, validate the single-use token server-side for the login action and hostname, and clear failures only after successful login.

### Ownership and storage

- Every resource row records `created_by`.
- A user may list, replace, and delete only their own resources.
- R2 keys are isolated beneath `users/{user-id}/file/` and `users/{user-id}/text/`.
- New public routes are `/file/{opaque-public-id}` and `/text/{opaque-public-id}`; generated URLs must not expose usernames, internal directories, or file names. Keep legacy username routes read-only for compatibility.
- `resource_sharing` owns opaque public IDs and text formats so schema initialization remains idempotent across Deploy button, CLI, and GitHub deployment paths.
- Resource activity events must survive resource deletion and remain owner-scoped.
- Directory and filename validation must reject traversal, ambiguous separators, and unsafe empty segments.
- Duplicate creation must not overwrite or delete an existing R2 object.
- File/text replacement keeps the public path and object key, preserves the kind, and increments the cache version.
- Administrator moderation deletes the R2 source object but retains the resource row and a `resource_moderation` audit tombstone with blocker and time.
- A blocked resource and every resource owned by a disabled account must fail the D1 availability check before any cached response can be served.
- Disabling a non-administrator revokes all sessions and API keys. The sole administrator cannot be disabled.

### D1 schema

- Runtime schema initialization in `src/schema.js` must remain idempotent.
- Deploy-time migrations under `migrations/` must represent applicable schema changes.
- Update both paths when adding a table, column, index, constraint, or trigger.
- Preserve foreign keys, ownership indexes, uniqueness constraints, and the single-administrator invariant.

### Public caching

- Only a GET with exactly one positive numeric `v` matching current D1 metadata may enter long-lived Cache API storage.
- A lightweight D1 availability check occurs before cache lookup so moderation and disabled accounts cannot be bypassed; an allowed cache hit must still occur before R2 access.
- Current version misses use browser `max-age=0`, one-year shared-cache retention, and `X-ImgHub-Cache: MISS`; hits use `HIT`.
- Unversioned, malformed, mismatched, extra-query, and HEAD requests use `BYPASS` and must not grow persistent cache keys.
- Replacement returns a new version URL so the stable path can retrieve new content without purging the previous key.

### Settings and lifecycle

- Site appearance values are administrator-controlled, length-validated, stored in D1, and rendered as text rather than HTML.
- The managed R2 lifecycle rule defaults to 91 days and applies to `users/`.
- Preserve unrelated Object Lifecycle Rules.
- Cloudflare API tokens used for lifecycle configuration must not be stored or logged.
- Lifecycle deletion is irreversible; do not perform a live update without explicit authorization.

## Browser extension and Agent Skill

- Chrome and Edge share the Chromium package; Firefox receives its own manifest variant.
- The extension must remain generic. Never compile a deployment domain or user credential into a package.
- The extension supports configurable HTTP localhost during development and configured HTTPS deployments in use.
- Shared popup changes must work in Chrome, Edge, and Firefox.
- Generated packages under `dist/extensions/` are release artifacts and are not source files.
- The distributable Agent Skill reads `IMG_HUB_URL` and `IMG_HUB_API_KEY` from the environment.
- Never place an actual `IMG_HUB_API_KEY` value in the Skill, prompts, fixtures, logs, screenshots, or source control.
- API clients must preserve the same ownership boundary as the browser application.

## Internationalization

- The supported UI languages are English (`en`) and Simplified Chinese (`zh-CN`).
- With no saved override, use the browser's first preferred locale: values beginning with `zh` select Chinese; every other value selects English.
- The explicit EN/中文 selection persists only in browser local storage under `img-hub-language`.
- Keep the English and Chinese catalogs in `public/i18n.js` key-for-key identical; `test/i18n.test.js` enforces parity.
- Static labels, placeholders, title/ARIA attributes, dynamic rows, Toast messages, prompts, confirmations, dates, empty states, and known API error codes must use the translation layer.
- Do not translate administrator-provided site appearance values automatically. Built-in unsaved welcome defaults should localize.
- A language change must update `document.documentElement.lang` and must not require a sign-out or full page reload.
- Test both languages on desktop and mobile when changing visible UI behavior.

## Cloudflare configuration and deployment

- Default `wrangler.jsonc` bindings must stay local-capable and must not set D1 or R2 `remote: true`.
- `scripts/deploy.mjs` must provision or reuse D1 and R2 idempotently, apply migrations, preserve unrelated lifecycle rules, and deploy only after explicit invocation.
- The shared deployment path must create or reuse its managed Turnstile widget through Wrangler, add the deployed/custom hostnames, and inject the secret with `--secrets-file` without logging or persisting it.
- Resource names must remain repository-specific by default so the upstream repository and forks do not collide.
- `ci.yml` is secret-free and validates pull requests to `develop`/`main` plus pushes to `develop`.
- `deploy.yml` validates every stable `main` update, including fork synchronization, and deploys only when that repository has both Cloudflare credentials.
- `release.yml` accepts matching `v*` tags contained in `main`, shares the `cloudflare-production` concurrency lock, builds both extension packages, creates a GitHub Release, and conditionally publishes configured stores.
- Never use `pull_request_target` to execute untrusted repository code with Secrets.
- Do not weaken workflow permissions or expose Secrets to pull request jobs.

## Documentation

- Keep `README.md` and `README.zh-CN.md` aligned.
- Keep `docs/index.html` and `docs/zh-CN.html` aligned for GitHub Pages.
- Keep `CONTRIBUTING.md` and `CONTRIBUTING.zh-CN.md` aligned.
- Update deployment instructions when scripts, Secrets, Variables, branch behavior, or release behavior changes.
- Update the manual testing checklist for user-visible workflows.
- Documentation written to Lark Doc, if ever requested, must be English.
- Do not claim a command was run or a deployment succeeded unless it was actually verified.

## Formatting and generated files

- No trailing whitespace on any line.
- Use four spaces for JavaScript and Python. Use two spaces for YAML, JSON, HTML, and CSS, following nearby project conventions.
- Preserve the dependency-free browser application unless a requested architecture change justifies a framework.
- Prefer small, cohesive modules and reusable tests over large route handlers or one-off scripts.
- Do not edit generated files when the source or build script should change.
- Do not commit `.wrangler/`, `wrangler.generated.json`, `dist/`, logs, coverage, `.env*`, credentials, cookies, or local uploads.
- Preserve unrelated user changes in a dirty working tree.

Before handing off a completed change, report the relevant tests and checks that actually passed, any manual verification performed, and any deployment or external operation intentionally not performed.
