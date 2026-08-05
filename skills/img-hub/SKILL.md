---
name: img-hub
description: Upload, list, replace, and delete files or text in a user-owned ImgHub deployment. Use when an agent needs to publish an artifact to ImgHub, return a stable public URL, update content without changing its path, or manage resources already stored there.
---

# ImgHub

Use the bundled client instead of constructing HTTP requests by hand.

## Configure

Require both environment variables before doing any work:

- `IMG_HUB_URL`: the deployed ImgHub origin, such as `https://images.example.com`
- `IMG_HUB_API_KEY`: an `imh_...` key created by the signed-in user

Never print, log, commit, or paste `IMG_HUB_API_KEY` into a command. The client reads it directly from the environment.

## Manage resources

Run commands from this skill directory with `python3 scripts/img_hub.py`:

```text
python3 scripts/img_hub.py list [--kind file|text]
python3 scripts/img_hub.py upload PATH [--directory RELATIVE/PATH]
python3 scripts/img_hub.py publish-text NAME (--content TEXT | --file PATH) [--directory RELATIVE/PATH]
python3 scripts/img_hub.py replace RESOURCE_ID PATH
python3 scripts/img_hub.py replace-text RESOURCE_ID (--content TEXT | --file PATH)
python3 scripts/img_hub.py delete RESOURCE_ID
```

Read the JSON response from stdout. For uploads and replacements, return the response resource's `url`; replacement keeps the stable path and changes its `?v=` cache version. Use `list` to find resource IDs before replacing or deleting.

Confirm with the user before `delete` unless deletion was explicitly requested. A resource is permanently removed from both metadata and object storage.

Directories are relative to the authenticated user's `/file` or `/text` root. Do not include a leading slash, `file`, `text`, or a username in `--directory`.
