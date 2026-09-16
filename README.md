# SOOB-Core-Web

Browser runtime for **2D SOOB-Core** games — [Find5](https://github.com/goph-R/Find5)
first, as a free web game. It reimplements SOOB-Core's narrow C binding surface
(the 25 bindings + lifecycle hooks documented in
[`SOOB-Lua.md`](https://github.com/goph-R/SOOB-Core/blob/main/SOOB-Lua.md)) in
TypeScript against web APIs, while the game's Lua scripts, the
`engine.scene/widget/animation/transition` modules, and `assets.lua` run
**unchanged**. Lua 5.1 itself runs in WebAssembly (the vendored `lua-5.1.5`
compiled with Emscripten) for exact behavioural parity with the desktop build.

3D (SOOB-Engine) is out of scope — this is the 2D core only.

## Layout

```
src/wasm/    bridge.c        C glue: registers the bindings onto a lua_State, marshals to the JS host
src/host/    gl/text/audio   WebGL1 batcher, BMFont, Web Audio
             assets/input    async asset loaders + DOM→hook input
             bindings/loop   the host object the bridge calls + the rAF frame loop
             lua.ts          loads the WASM module, runs the scripts, drives the hooks
             appinfo.ts      the game's identity (app.lua): title, PWA manifest, save key
src/game/    main.ts         boot sequence
scripts/     build-lua.sh    emsdk: compile lua-5.1.5 + bridge.c → public/lua/liblua.{mjs,wasm}
             game-path.mjs   which game to build: SOOB_GAME env, else package.json "soobGame"
             sync-game.mjs   pull that game's scripts + assets into public/game/ (the game stays source of truth)
```

`public/lua/` and `public/game/` are generated, not committed.

## Develop

```sh
npm install
npm run build-lua        # compile the Lua-WASM module (needs emcc — see below)
npm run dev              # vite dev server (auto-runs sync-game first)
```

Requires a game bundle and [`SOOB-Core`](https://github.com/goph-R/SOOB-Core)
(for the vendored Lua sources) as siblings of this repo.

### Which game

`package.json`'s `soobGame` field names the game folder (`"../Find5"` by
default). Override it per run without editing anything:

```sh
SOOB_GAME=../MyGame npm run dev
```

The game supplies its own identity (`app.lua` — name, id, orientation,
description, background colour) and its own PWA icon at `<game>/web/icon.svg`;
if it ships none, `public/icon.default.svg` is used. Note that `config.lua` is
**not** copied into the bundle — every field in it is desktop-only.

### Emscripten (one-time)

`build-lua.sh` compiles the Lua sources with `emcc`. If you see
`error: emcc not found`, install the Emscripten SDK. The simplest option is to
clone it as a sibling of this repo (at `../emsdk`) — the script sources it
automatically when `emcc` isn't already on `PATH`:

```sh
cd ..                    # the folder beside SOOB-Core-Web
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
```

Needs Python 3 and Git on `PATH`. To install emsdk elsewhere, point the script
at it instead: `EMSDK_DIR=/path/to/emsdk npm run build-lua`.

**Windows:** the build scripts run under `bash`. If `npm run build-lua` reports
`emcc not found` even after installing emsdk, npm is likely invoking WSL's
`bash` (`C:\WINDOWS\system32\bash.exe`) instead of Git Bash. Point npm at Git
Bash once:

```sh
npm config set script-shell "C:\Program Files\Git\bin\bash.exe"
```

## Status

Milestones M0–M5 are in: Lua-WASM boots, the full renderer (BMFont, ellipse
ribbon, FBO blur), Web Audio with music crossfade, options in localStorage,
mobile landscape with the rotate prompt, the IME soft-keyboard bridge, and PWA
packaging. Find5 plays in a desktop and a mobile browser.

The game's identity — tab title, PWA name/description/orientation, save key —
comes from the bundle's `app.lua`, the same file the desktop and Android hosts
read (see [`SOOB-Lua.md`](https://github.com/goph-R/SOOB-Core/blob/main/SOOB-Lua.md)).

There is a sibling now: [`SOOB-Core-Android`](https://github.com/goph-R/SOOB-Core-Android)
is the same binding surface hosted in Kotlin on the NDK. The plan for this one
is in `SOOB-Core/SOOB-Core-Web.md`.
