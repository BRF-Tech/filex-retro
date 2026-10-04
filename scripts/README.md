# scripts

| Script | What |
|---|---|
| `build-engine.sh` | builds the DOOM-engine player's WebAssembly (`build/engines/doom/retro-doom.{js,wasm}`) in the pinned `emscripten/emsdk:6.0.10` image, with Docker; the work itself is `engines/doom/build.sh` (pinned upstream commits plus this repository's patches) |
| `build.sh` | packs `ui.zip` and `ui.zip.sha256` (needs `npm ci`, which brings js-dos 8.5.1's `emulators` for the DOS player, and the DOOM engine); `--stamp` writes the sha256 into `filex-app.json`, `--check` fails unless it is already there |
| `release-notes.mjs` | prints a version's `CHANGELOG.md` section, the body of its GitHub release; fails when the section is missing or still has no release date |
| `pack.mjs` | the packer behind `build.sh`: sorted entries, every entry stored, a fixed date, LF text; a 64 MiB gate (`RETRO_MAX_ZIP_MB`); refuses game data among its inputs and a manifest view whose page is missing |

No script here downloads game data into the repository or into `ui.zip`.
