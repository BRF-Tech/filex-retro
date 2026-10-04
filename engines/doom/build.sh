#!/usr/bin/env bash
# Builds the DOOM-engine player's WebAssembly (retro-doom.js + .wasm).
#
# Runs inside the pinned Emscripten image, with this repository at $SRC:
#
#   docker run --rm -v "$PWD:/src:ro" -v <work>:/build -v <out>:/out \
#     emscripten/emsdk:6.0.10 bash /src/engines/doom/build.sh
#
# (scripts/build-engine.sh does exactly that.) Inputs, all pinned:
#   - ozkl/doomgeneric at DG_COMMIT: the engine (Chocolate Doom's DOOM code
#     with a six-function platform interface), GPL-2.0;
#   - chocolate-doom/chocolate-doom at CD_COMMIT (tag chocolate-doom-3.1.1):
#     only its OPL music - i_oplmusic.c, midifile.c and opl/ with the Nuked
#     OPL3 emulator - GPL-2.0;
#   - this repository's patches (engines/doom/patches) and platform layer
#     (engines/doom/retro_*.c).
# Upstream sources are cloned into $WORK, never into the repository; SDL 2
# and SDL_mixer come from Emscripten's ports (SDL 2.32.10, SDL_mixer 2.8.0,
# downloaded by emcc and checked against the hashes Emscripten pins). Nothing
# here downloads game data. The same inputs give the same bytes: the paths
# baked into the objects are mapped to fixed names, nothing carries a date.
set -euo pipefail

SRC=${SRC:-/src}
WORK=${WORK:-/build}
OUT=${OUT:-/out}
EMSDK_VERSION=6.0.10

DG_REPO=https://github.com/ozkl/doomgeneric.git
DG_COMMIT=dcb7a8dbc7a16ce3dda29382ac9aae9d77d21284
CD_REPO=https://github.com/chocolate-doom/chocolate-doom.git
CD_COMMIT=410d96855b5df5410ff591a90efeafa889119224

# The engine's own files (doomgeneric's Makefile.emscripten, without its
# emscripten platform file and without SDL_mixer's MIDI music module).
DG_FILES="dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net
f_finale f_wipe g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound i_system
i_timer memio m_argv m_bbox m_cheat m_config m_controls m_fixed m_menu m_misc m_random p_ceilng
p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats p_pspr p_saveg p_setup
p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw r_main r_plane r_segs r_sky
r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video wi_stuff w_checksum w_file
w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric mus2mid i_sdlsound"
# From Chocolate Doom: source path -> name in the build tree's opl/.
CD_FILES="src/i_oplmusic.c src/midifile.c src/midifile.h opl/opl.c opl/opl.h opl/opl_internal.h
opl/opl_queue.c opl/opl_queue.h opl/opl_sdl.c opl/opl3.c opl/opl3.h"
OPL_UNITS="i_oplmusic midifile opl opl_queue opl_sdl opl3"

emcc --version | head -1
emcc --version | head -1 | grep -q " $EMSDK_VERSION " || {
  echo "this build is pinned to emsdk $EMSDK_VERSION" >&2
  exit 1
}

fetch() {
  local repo=$1 commit=$2 dir=$3
  if [ ! -d "$dir/.git" ]; then
    git clone --quiet --no-checkout "$repo" "$dir"
  fi
  if ! git -C "$dir" cat-file -e "$commit^{commit}" 2> /dev/null; then
    git -C "$dir" fetch --quiet origin
  fi
  git -C "$dir" -c advice.detachedHead=false checkout --quiet --force "$commit"
  git -C "$dir" clean -fdxq
  [ "$(git -C "$dir" rev-parse HEAD)" = "$commit" ] || {
    echo "$dir is not at $commit" >&2
    exit 1
  }
  echo "$repo @ $commit"
}

mkdir -p "$WORK" "$OUT"
fetch "$DG_REPO" "$DG_COMMIT" "$WORK/doomgeneric"
fetch "$CD_REPO" "$CD_COMMIT" "$WORK/chocolate-doom"

# The tree that is compiled: copies, so the clones stay pristine.
T=$WORK/tree
rm -rf "$T"
mkdir -p "$T/dg" "$T/opl" "$T/retro" "$T/obj"
cp -p "$WORK"/doomgeneric/doomgeneric/*.c "$WORK"/doomgeneric/doomgeneric/*.h "$T/dg/"
for f in $CD_FILES; do cp -p "$WORK/chocolate-doom/$f" "$T/opl/"; done
cp -p "$SRC"/engines/doom/retro_platform.c "$SRC"/engines/doom/retro_compat.c "$SRC"/engines/doom/retro_compat.h "$T/retro/"
for p in "$SRC"/engines/doom/patches/*.patch; do
  echo "patch $(basename "$p")"
  patch --quiet --no-backup-if-mismatch -d "$T" -p1 < "$p"
done

CFLAGS=(
  -O3
  -DFEATURE_SOUND
  -DDOOMGENERIC_RESX=320
  -DDOOMGENERIC_RESY=200
  -sUSE_SDL=2
  -sUSE_SDL_MIXER=2
  "-sSDL2_MIXER_FORMATS=[]"
  "-ffile-prefix-map=$T/=retro-doom/"
)
LDFLAGS=(
  -O3
  -sMODULARIZE=1
  -sEXPORT_NAME=RetroDoom
  -sINVOKE_RUN=0
  -sEXIT_RUNTIME=0
  -sENVIRONMENT=web
  -sDYNAMIC_EXECUTION=0
  -sFORCE_FILESYSTEM=1
  -sEXPORTED_RUNTIME_METHODS=FS,callMain,HEAPU8,UTF8ToString
  -sEXPORTED_FUNCTIONS=_main
  -sINITIAL_MEMORY=64MB
  -sALLOW_MEMORY_GROWTH=1
  -sMAXIMUM_MEMORY=128MB
  -sSTACK_SIZE=512KB
  -Wl,--wrap=exit
)

compile() {
  local src=$1 obj=$2
  shift 2
  emcc "${CFLAGS[@]}" "$@" -c "$src" -o "$obj"
}
# Ours and the OPL files first: they are the ones a change breaks.
OBJS=()
for f in retro_platform retro_compat; do
  compile "$T/retro/$f.c" "$T/obj/retro_$f.o" -I"$T/retro" -I"$T/dg"
  OBJS+=("$T/obj/retro_$f.o")
done
for f in $OPL_UNITS; do
  compile "$T/opl/$f.c" "$T/obj/opl_$f.o" -I"$T/opl" -I"$T/dg" -include "$T/retro/retro_compat.h"
  OBJS+=("$T/obj/opl_$f.o")
done
for f in $DG_FILES; do
  compile "$T/dg/$f.c" "$T/obj/dg_$f.o" -I"$T/dg"
  OBJS+=("$T/obj/dg_$f.o")
done

emcc "${CFLAGS[@]}" "${OBJS[@]}" -o "$OUT/retro-doom.js" "${LDFLAGS[@]}" -lm -lc

cd "$OUT"
for f in retro-doom.js retro-doom.wasm; do
  echo "SIZE $f raw=$(stat -c %s "$f") gzip9=$(gzip -9 -c "$f" | wc -c)"
done
echo "SCAN retro-doom.js eval=$(grep -c -E '[^a-zA-Z_.$]eval\(|new Function\(' retro-doom.js || true) websocket=$(grep -c -i 'websocket' retro-doom.js || true)"
sha256sum retro-doom.js retro-doom.wasm
echo ENGINE_DONE
