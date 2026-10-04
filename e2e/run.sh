#!/usr/bin/env bash
# End-to-end tests on a Docker host: the real filex, the real app frame,
# Chromium, Firefox and WebKit. Phases, run in order:
#
#   bash e2e/run.sh prep    Freedoom (downloaded once, checked against its
#                           release's CHECKSUM) + our own fixtures, into $ROOT/files
#                           (DOS: our DOSPROBE.COM, assembled from e2e/dos/probe.asm)
#   bash e2e/run.sh pack    ui.zip from the checkout at $ROOT/src (the engine
#                           build must be in $ENGINE_OUT)
#   bash e2e/run.sh up      filex ($FILEX_IMAGE, or $FILEX_BINARY in that image)
#                           with $ROOT/files as its storage
#   bash e2e/run.sh test    the Playwright driver (e2e/retro.mjs), detached;
#                           results in $ROOT/out/$OUTNAME, log in $ROOT/logs
#   bash e2e/run.sh down    removes this run's containers
#
# RETRO_E2E_ROOT is the work folder (its src/ is a copy of this checkout).
# Heavy phases (up, test) take a build lock ($LOCK) that a host shared with
# other builds can point at its own. Game data stays on the host: nothing
# here writes into the repository.
#
# The filex under test is $FILEX_IMAGE (the oldest release the manifest
# accepts, by default). FILEX_MIN overrides the manifest's own "filex" range
# for the run (an older filex); SAVEAS=0 tests a filex without the save
# dialog apps can use (before 0.51.0).
set -euo pipefail
ROOT=${RETRO_E2E_ROOT:?set RETRO_E2E_ROOT to the work folder, with this checkout in its src/}
REPO=$ROOT/src
LOCK=${LOCK:-$ROOT/.build.lock}
CACHE=${RETRO_CACHE:-$ROOT/cache}
ENGINE_OUT=${ENGINE_OUT:-$ROOT/out/engine}
FILEX_IMAGE=${FILEX_IMAGE:-ghcr.io/brf-tech/filex:v0.51.0}
PWIMG=mcr.microsoft.com/playwright:v1.59.1-noble
NODEIMG=node:22
ALPINE=alpine:3.21
NAME=${E2E_NAME:-side-retro-doom}
OUTNAME=${OUTNAME:-e2e}
FREEDOOM_URL=https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip
FREEDOOM_SUMS=https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0-CHECKSUM

mkdir -p "$ROOT/files" "$ROOT/logs" "$ROOT/out"
phase=${1:-}

case "$phase" in
prep)
  if [ ! -f "$CACHE/freedoom/freedoom-0.13.0/freedoom2.wad" ]; then
    mkdir -p "$CACHE"
    docker run --rm -v "$CACHE:/c" "$ALPINE" sh -c '
      set -e
      apk add --no-cache curl unzip > /dev/null
      cd /c
      curl -fsSL -o freedoom-0.13.0.zip '"$FREEDOOM_URL"'
      curl -fsSL -o freedoom-0.13.0-CHECKSUM '"$FREEDOOM_SUMS"'
      want=$(grep "freedoom-0.13.0.zip" freedoom-0.13.0-CHECKSUM | grep -o "[0-9a-f]\{64\}" | head -1)
      have=$(sha256sum freedoom-0.13.0.zip | cut -d" " -f1)
      [ "$want" = "$have" ] || { echo "freedoom checksum mismatch"; exit 1; }
      rm -rf freedoom && mkdir freedoom && unzip -q freedoom-0.13.0.zip -d freedoom
    '
  fi
  find "$ROOT/files" -maxdepth 1 -type f -delete
  cp "$CACHE/freedoom/freedoom-0.13.0/freedoom2.wad" "$CACHE/freedoom/freedoom-0.13.0/freedoom1.wad" "$ROOT/files/"
  docker run --rm -v "$ROOT:/w" -w /w/src "$NODEIMG" node e2e/fixtures.mjs /w/files /w/files/freedoom2.wad chromium firefox webkit
  docker run --rm -v "$ROOT:/w" "$ALPINE" sh -c 'apk add --no-cache nasm > /dev/null && mkdir -p /w/out && nasm -f bin -o /w/out/DOSPROBE.COM /w/src/e2e/dos/probe.asm'
  docker run --rm -v "$ROOT:/w" -w /w/src "$NODEIMG" node e2e/dos/fixtures.mjs /w/files /w/out/DOSPROBE.COM chromium firefox webkit
  [ -f "$ROOT/admin.pw" ] || head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$ROOT/admin.pw"
  ls -l "$ROOT/files"
  ;;
pack)
  mkdir -p "$REPO/build/engines/doom"
  cp "$ENGINE_OUT/retro-doom.js" "$ENGINE_OUT/retro-doom.wasm" "$REPO/build/engines/doom/"
  docker run --rm -v "$ROOT:/w" -v "$CACHE/npm:/npmcache" -e npm_config_cache=/npmcache -w /w/src "$NODEIMG" \
    bash -c '[ -d node_modules/@brftech/filex-app-ui ] || npm ci --no-audit --no-fund --silent; node scripts/pack.mjs' > "$ROOT/logs/pack.log" 2>&1
  tail -3 "$ROOT/logs/pack.log"
  ;;
up)
  exec 9> "$LOCK"
  flock 9
  docker rm -f "$NAME-filex" > /dev/null 2>&1 || true
  rm -rf "$ROOT/data"
  mkdir -p "$ROOT/data"
  # FILEX_BINARY: a filex built from source (an unreleased commit), run in
  # the released image's runtime in place of its own binary.
  BIN_MOUNT=()
  if [ -n "${FILEX_BINARY:-}" ]; then
    BIN_MOUNT=(-v "$FILEX_BINARY:/usr/local/bin/filex:ro")
  fi
  docker run -d --name "$NAME-filex" "${BIN_MOUNT[@]}" \
    -v "$ROOT/data:/data" -v "$ROOT/files:/srv/games" \
    -e FILEX_ADMIN_EMAIL=admin@local -e FILEX_ADMIN_PASSWORD="$(cat "$ROOT/admin.pw")" \
    -e FILEX_DEFAULT_STORAGE_DRIVER=local -e FILEX_DEFAULT_STORAGE_PATH=/srv/games -e FILEX_DEFAULT_STORAGE_NAME=games \
    -e FILEX_PUBLIC_URL=http://localhost:5212 -e FILEX_APP_PLUGINS_DISABLED=0 \
    "$FILEX_IMAGE" > /dev/null
  for i in $(seq 1 90); do
    if docker exec "$NAME-filex" wget -q -O /dev/null http://127.0.0.1:5212/healthz 2> /dev/null; then
      echo "filex up after ${i}s ($FILEX_IMAGE${FILEX_BINARY:+ with $FILEX_BINARY})"
      break
    fi
    sleep 1
  done
  ;;
test)
  rm -rf "$ROOT/run" && mkdir -p "$ROOT/run" "$CACHE/npm"
  # The run takes its own copy of the package: the checkout may change while
  # the run waits for the lock.
  cp "$REPO/e2e/package.json" "$REPO/e2e/retro.mjs" "$REPO/e2e/dos.mjs" "$REPO/filex-app.json" "$REPO/ui.zip" "$ROOT/run/"
  docker rm -f "$NAME-pw" > /dev/null 2>&1 || true
  LOGN="$ROOT/logs/$OUTNAME.log"
  PRE=""
  if [ "${AUDIO:-1}" = 1 ]; then
    PRE="apt-get update -qq > /dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq pulseaudio > /dev/null && pulseaudio -D --exit-idle-time=-1 && pactl load-module module-null-sink sink_name=e2e > /dev/null && pactl set-default-sink e2e &&"
  fi
  setsid -f bash -c "flock $LOCK docker run --rm --name $NAME-pw --network container:$NAME-filex --shm-size=1g -v $ROOT:/w -v $CACHE/npm:/npmcache -e npm_config_cache=/npmcache -e BROWSERS=${BROWSERS:-chromium,firefox,webkit} -e ONLY=${ONLY:-} -e SAVEAS=${SAVEAS:-1} -e FILEX_MIN=${FILEX_MIN:-} -e OUT=/w/out/$OUTNAME $PWIMG bash -c 'cd /w/run && npm install --no-audit --no-fund --silent && $PRE timeout 1700 node retro.mjs' > $LOGN 2>&1; echo EXIT=\$? >> $LOGN" > /dev/null 2>&1 < /dev/null
  echo "started: $LOGN"
  ;;
down)
  docker rm -f "$NAME-pw" "$NAME-filex" > /dev/null 2>&1 || true
  echo down
  ;;
*)
  echo "usage: e2e/run.sh prep|pack|up|test|down" >&2
  exit 2
  ;;
esac
