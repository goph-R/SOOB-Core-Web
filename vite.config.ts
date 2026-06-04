import { defineConfig } from 'vite'

// base './' keeps all asset URLs relative so the static build drops straight
// onto itch.io / any static host with no path config.
//
// The Emscripten Lua module (public/lua/liblua.mjs + .wasm) and the synced
// game bundle (public/game/**) are served verbatim from public/ — they are
// build artifacts (build-lua.sh / sync-game.mjs), not source Vite transforms.
export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
})
