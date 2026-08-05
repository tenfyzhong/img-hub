## Summary

Describe the problem and the resulting behavior. Link the related issue when one exists.

## Changes

- _List the important implementation and documentation changes._

## Test evidence

- [ ] The target branch is `develop` for feature/fix/docs work, or `main` only for a release/hotfix.
- [ ] I added or updated reusable tests before production code and saw them fail for the expected reason, or this is documentation/configuration only.
- [ ] `npm test`
- [ ] `npm run test:local`
- [ ] `npm run check:deploy` when Worker, configuration, deployment, or release behavior changed.
- [ ] `npm run build:extension` when extension or release behavior changed.
- [ ] I manually tested the affected behavior, or explained below why manual testing is not applicable.

Manual test steps and results:

1. _Describe a reproducible manual check and its result._

## Compatibility, security, and operations

- [ ] User ownership and per-user R2 isolation remain enforced.
- [ ] No password, API key, token, cookie, private URL, or user data is included.
- [ ] I documented any migration, cache, deployment, lifecycle, or compatibility impact.
- [ ] English and Chinese documentation remain aligned when user-facing behavior changed.
- [ ] All commits are signed off with `git commit -s`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) or [CONTRIBUTING.zh-CN.md](../CONTRIBUTING.zh-CN.md) for the full workflow and manual testing checklist.
