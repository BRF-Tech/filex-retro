# Changelog

All notable changes to this app are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-04

The first version: the DOOM-engine player and the DOS player. Needs filex
0.51.0 or newer.

### Added

- **DOOM-engine player** (view `doom`) for `.wad` and `.fxdoom` files, in
  place of the preview: doomgeneric `dcb7a8d` (Chocolate Doom's engine)
  compiled to WebAssembly with Emscripten 6.0.10, drawn on a 2D canvas (no
  WebGL), a main loop that runs a tic only when the 35 Hz game clock moves,
  wasm memory capped at 128 MiB.
- Music: Chocolate Doom 3.1.1's OPL music with the Nuked OPL3 emulator
  (the games' Sound Blaster FM music), mixed with the sound effects by
  SDL_mixer.
- **Settings** per person, kept by filex with the account: Music and Sound
  effects, each switched on and off at once; with music off the OPL chip is
  not emulated.
- The game is recognised from the lumps inside the IWAD (DOOM, DOOM II,
  Final DOOM, Freedoom, FreeDM), so a renamed IWAD plays. A PWAD on its own,
  Heretic, Hexen and Strife, a damaged WAD and files that only share the
  extension (Half-Life WAD3, Quake WAD2, Wii WADs) get a message instead of a
  start.
- **Saved games**: the `.fxdoom` pack (the IWAD, the saves and the engine's
  settings in one zip, laid out the same way every time). From a `.wad`,
  **Keep saves…** writes a new pack through filex's own folder dialog (filex
  0.51.0); in a pack, **Save** (and filex's own Save) writes a new version
  of it. Ctrl+S is left to the game (Ctrl fires).
- **DOS player** (view `dos`) for `.jsdos` bundles, in place of the preview:
  js-dos 8.5.1's DOSBox (the npm `emulators` package, unchanged), loaded
  from the app's package without `eval` and run in a worker, drawn by Retro
  itself: its own screen, sound (resampled to the device's rate), keyboard
  and mouse. Single-threaded DOSBox only; no network.
- A bundle with no `dosbox.conf` (a zip of a game folder) asks which DOS
  program starts it, best guess first; the choice is remembered for that
  file and written into the bundle at the first save. **Change program** on
  the Start screen.
- DOS saving: **Save** (and filex's own Save) merges what the game changed
  and deleted into the bundle, written the same way every time (sorted
  entries, a fixed date, unchanged files copied as they were), as a new
  version of the file; nothing is written when nothing changed. Bundles
  over 64 MiB get a note that every save writes them whole. A bundle that is
  not a zip, is damaged, encrypted, empty or has nothing to start gets a
  message instead of a start.
- The shared player shell (`src/shell/`): the filex bridge, the Start screen
  whose click also starts the sound, a pause while the page is hidden or the
  settings are open, English and Turkish, filex's colours, a deterministic
  zip reader and writer.
- Reproducible build: `scripts/build-engine.sh` (pinned upstream commits,
  this repository's patches, pinned Emscripten image), `scripts/build.sh`
  (deterministic `ui.zip`, `--stamp`, `--check`, a 64 MiB size gate, no game
  data among the inputs), and a release workflow that rebuilds both from
  scratch and attaches `ui.zip` only when its sha256 is the one
  `filex-app.json` pins.
- Tests: unit tests (vitest) and end-to-end tests against a real filex in
  Chromium, Firefox and WebKit (`e2e/`); the DOS ones run our own small DOS
  program (`e2e/dos/probe.asm`).
