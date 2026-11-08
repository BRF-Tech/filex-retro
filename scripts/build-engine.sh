#!/usr/bin/env bash
# Builds the DOOM-engine player's WebAssembly in the pinned Emscripten image
# (engines/doom/build.sh does the work). Needs Docker.
#
#   scripts/build-engine.sh        -> build/engines/doom/retro-doom.{js,wasm}
#
# The upstream clones are kept in .cache/engine-doom (RETRO_ENGINE_WORK moves
# them), so a second build does not clone them again. The image is pinned by
# its digest as well as its tag: a tag can be pushed again, a digest cannot.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=emscripten/emsdk:7.0.0@sha256:6bd7aef93408b10bf7b36642cb7c91119b302f720b9ec2d20439f73cf07fe894
WORK=${RETRO_ENGINE_WORK:-$ROOT/.cache/engine-doom}
OUT=$ROOT/build/engines/doom
mkdir -p "$WORK" "$OUT"
docker run --rm -v "$ROOT:/src:ro" -v "$WORK:/build" -v "$OUT:/out" "$IMAGE" bash /src/engines/doom/build.sh
