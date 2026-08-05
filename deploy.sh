#!/usr/bin/env sh
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

npm run deploy:cloudflare
