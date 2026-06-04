// main.ts — boot sequence for the Find5 web build.
//
// Order matters and mirrors the desktop host: stand up the renderer + host
// object, load the Lua VM, preload the game's .lua into MEMFS, register assets
// (sync metadata), AWAIT all texture/font loads (the sync→async gate), then run
// main.lua and fire onStart before the frame loop starts.

import { initGL } from '../host/gl'
import { installBindings } from '../host/bindings'
import { attachInput } from '../host/input'
import * as lua from '../host/lua'
import { loadAll } from '../host/assets'
import { startLoop } from '../host/loop'

interface Manifest { lua: string[] }

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement

  initGL(canvas)          // WebGL context + virtual canvas
  installBindings()       // globalThis.__SOOB — the surface the bridge calls
  attachInput(canvas)     // DOM events → hooks + polling state

  await lua.initLua()     // load liblua.wasm, soob_new()

  // Preload every .lua into MEMFS so require() + luaL_loadfile resolve.
  const manifest: Manifest = await (await fetch('game/manifest.json')).json()
  await Promise.all(manifest.lua.map(async rel => {
    const text = await (await fetch('game/' + rel)).text()
    lua.writeLuaFile(rel, text)
  }))

  lua.loadAssets()        // run assets.lua → register* metadata into the host
  await loadAll()         // fetch/decode/upload textures + fonts (the gate)

  lua.doFile('scripts/main.lua')
  lua.callHook('onStart')
  startLoop()
}

boot().catch(err => {
  console.error(err)
  document.body.innerHTML =
    '<pre style="color:#f88;padding:1rem;font:14px monospace;white-space:pre-wrap">' +
    String(err && (err.stack || err)) + '</pre>'
})
