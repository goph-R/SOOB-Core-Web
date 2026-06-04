// lua.ts — loads the Emscripten Lua module, preloads the game's .lua files into
// MEMFS, and exposes the bridge entry points (run scripts, fire hooks).
//
// The C bridge resolves require() against /game/scripts via package.path and
// reads assets.lua / main.lua with luaL_loadfile from MEMFS, so the boot order
// mirrors the desktop host: write scripts → loadAssets → run main → onStart.

// liblua.mjs is an Emscripten ES6 module in public/ (served at /lua/). It is a
// build artifact, not a Vite source — import it by URL with @vite-ignore so
// Vite leaves it (and its sibling .wasm) alone.
type LuaModule = {
  ccall: (fn: string, ret: string | null, argT: string[], args: unknown[]) => unknown
  cwrap: (fn: string, ret: string | null, argT: string[]) => (...a: unknown[]) => unknown
  FS: { mkdir: (p: string) => void; writeFile: (p: string, d: string) => void }
}

let M: LuaModule
let _update: (dt: number) => void
let _render: () => void
let _mouseMove: (x: number, y: number, dx: number, dy: number) => void

export async function initLua(): Promise<void> {
  const url = new URL('/lua/liblua.mjs', import.meta.url).href
  const createLua = (await import(/* @vite-ignore */ url)).default
  M = await createLua()
  M.ccall('soob_new', null, [], [])
  _update = M.cwrap('soob_update', null, ['number']) as (dt: number) => void
  _render = M.cwrap('soob_render', null, []) as () => void
  _mouseMove = M.cwrap('soob_mouseMove', null, ['number', 'number', 'number', 'number']) as
    (x: number, y: number, dx: number, dy: number) => void
}

function mkdirp(dir: string) {
  let cur = ''
  for (const part of dir.split('/')) {
    if (!part) continue
    cur += '/' + part
    try { M.FS.mkdir(cur) } catch { /* exists */ }
  }
}

// Write one .lua file into MEMFS under /game/<rel>.
export function writeLuaFile(rel: string, text: string) {
  const full = '/game/' + rel
  mkdirp(full.slice(0, full.lastIndexOf('/')))
  M.FS.writeFile(full, text)
}

export function loadAssets(): boolean {
  return !!M.ccall('soob_loadAssets', 'number', ['string'], ['/game/assets.lua'])
}
export function doFile(rel: string): boolean {
  return !!M.ccall('soob_doFile', 'number', ['string'], ['/game/' + rel])
}
export function callHook(name: string) { M.ccall('soob_callHook0', null, ['string'], [name]) }

export function update(dt: number) { _update(dt) }
export function render() { _render() }
export function mouseDown(x: number, y: number, b: number) { M.ccall('soob_mouseDown', null, ['number', 'number', 'number'], [x, y, b]) }
export function mouseUp(x: number, y: number, b: number) { M.ccall('soob_mouseUp', null, ['number', 'number', 'number'], [x, y, b]) }
export function mouseMove(x: number, y: number, dx: number, dy: number) { _mouseMove(x, y, dx, dy) }
export function keyDown(name: string) { M.ccall('soob_keyDown', null, ['string'], [name]) }
export function keyUp(name: string) { M.ccall('soob_keyUp', null, ['string'], [name]) }
export function textInput(ch: string) { M.ccall('soob_textInput', null, ['string'], [ch]) }
