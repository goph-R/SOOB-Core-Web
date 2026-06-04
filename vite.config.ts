import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      devOptions: { enabled: false },
      manifest: {
        name: 'Find5',
        short_name: 'Find5',
        description: 'Spot-the-difference — a SOOB-Core game.',
        theme_color: '#14141f',
        background_color: '#14141f',
        display: 'fullscreen',
        orientation: 'landscape',
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
