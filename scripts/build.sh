#!/usr/bin/env bash
# Builds ui.zip from this checkout (scripts/pack.mjs does the packing).
#
#   npm ci                          the SDK, js-dos's emulators and the
#                                   test tools, as locked
#   scripts/build-engine.sh         the DOOM engine (Docker), once
#   scripts/build.sh [--stamp|--check]
#
# --stamp writes ui.zip's sha256 into filex-app.json (a release commit);
# --check fails unless filex-app.json already names it (the release build).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f build/engines/doom/retro-doom.wasm ] || {
  echo "build: no engine; run scripts/build-engine.sh first" >&2
  exit 1
}
[ -f node_modules/@brftech/filex-app-ui/dist/filex-app-ui.iife.js ] || {
  echo "build: no SDK; run npm ci first" >&2
  exit 1
}
[ -f node_modules/emulators/dist/wdosbox.wasm ] || {
  echo "build: no js-dos emulators; run npm ci first" >&2
  exit 1
}
node scripts/pack.mjs "$@"
