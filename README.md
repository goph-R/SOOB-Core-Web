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
src/game/    main.ts         boot sequence
scripts/     build-lua.sh    emsdk: compile lua-5.1.5 + bridge.c → public/lua/liblua.{mjs,wasm}
             sync-game.mjs   pull ../Find5 scripts + assets into public/game/ (Find5 stays source of truth)
```

`public/lua/` and `public/game/` are generated, not committed.

## Develop

```sh
# one-time: install Emscripten (https://emscripten.org), then
npm install
npm run build-lua        # compile the Lua-WASM module (needs emcc on PATH)
npm run dev              # vite dev server (auto-runs sync-game first)
```

Requires a checkout of [`Find5`](https://github.com/goph-R/Find5) and
[`SOOB-Core`](https://github.com/goph-R/SOOB-Core) as siblings of this repo
(for the game bundle and the vendored Lua sources, respectively).

## Status

Milestones M0–M1: Lua-WASM boots and the Find5 title screen renders in the
browser. Audio, the full renderer (ellipse ribbon / blur), persistence, mobile,
and PWA packaging follow — see the plan in `SOOB-Core/SOOB-Core-Web.md`.
