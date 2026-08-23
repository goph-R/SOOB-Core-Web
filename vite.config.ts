import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { DEFAULT_APP, parseAppLua } from './src/host/appinfo'

// Identity comes from the game bundle, not from this file: sync-game.mjs has
// already copied app.lua into public/game/ by the time vite starts (the npm
// predev/prebuild hooks). Falling back to the sibling checkout keeps a bare
// `vite` invocation working.
function loadAppInfo() {
  for (const path of ['public/game/app.lua', '../Find5/app.lua']) {
    try {
      return parseAppLua(readFileSync(path, 'utf8'))
    } catch {
      // try the next one
    }
  }
  console.warn('vite: no app.lua found — building unnamed')
  return DEFAULT_APP
}

const app = loadAppInfo()

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
  plugins: [
    {
      // <title>%APP_NAME%</title> in index.html — the tab is named before any
      // script runs; the runtime sets document.title again from the same file.
      name: 'soob-app-title',
      transformIndexHtml: (html: string) => html.replace(/%APP_NAME%/g, app.name),
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      devOptions: { enabled: false },
      manifest: {
        name: app.name,
        short_name: app.name,
        description: app.description,
        theme_color: '#14141f',
        background_color: '#14141f',
        display: 'fullscreen',
        orientation: app.orientation,
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // Precache the app shell + small assets; stream music at runtime so the
        // first load isn't a ~20 MB download.
        globPatterns: ['**/*.{js,css,html,wasm,mjs,png,wav,lua,json,svg}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\.(?:ogg|m4a)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'soob-music', expiration: { maxEntries: 8 } },
          },
        ],
      },
    }),
  ],
})
