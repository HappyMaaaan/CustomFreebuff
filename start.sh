#!/usr/bin/env bash
# CustomFreebuff — theme studio for Freebuff Desktop.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org and try again." >&2
  exit 1
fi

exec node themer.mjs
